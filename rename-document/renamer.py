"""
Document type detection using OCR + Azure OpenAI.

Public API:
  detect_doc_type(file_bytes, mime_type) -> str
    Returns one of: CAS, EAPP, LOR, TRANSCRIPT, GRADE_SHEET, ID_PROOF,
                    RESUME, STATEMENT, RECOMMENDATION, UNKNOWN
"""

import io
import json
import re

from langchain_openai import AzureChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage
import config


# ------------------------------------------------------------------
# Azure OpenAI LLM (lazy singleton)
# ------------------------------------------------------------------

_llm = None


def _get_llm() -> AzureChatOpenAI:
    global _llm
    if _llm is None:
        _llm = AzureChatOpenAI(
            azure_deployment=config.AZURE_OPENAI_DEPLOYMENT_NAME,
            azure_endpoint=config.AZURE_OPENAI_ENDPOINT,
            api_key=config.AZURE_OPENAI_API_KEY,
            api_version=config.AZURE_OPENAI_API_VERSION,
            temperature=0,
            max_tokens=200,
        )
    return _llm


# ------------------------------------------------------------------
# Text extraction
# ------------------------------------------------------------------

def _extract_text_from_pdf(file_bytes: bytes) -> str:
    """Extract text from PDF. Falls back to OCR for scanned PDFs."""
    from PyPDF2 import PdfReader

    reader = PdfReader(io.BytesIO(file_bytes))
    text_parts = []
    for page in reader.pages:
        page_text = page.extract_text()
        if page_text:
            text_parts.append(page_text)
    text = "\n".join(text_parts)

    # If text is too short, likely a scanned PDF — use OCR
    if len(text.strip()) < 50:
        text = _ocr_pdf(file_bytes)

    return text


def _ocr_pdf(file_bytes: bytes) -> str:
    """OCR a scanned PDF using pdf2image + pytesseract."""
    from pdf2image import convert_from_bytes
    import pytesseract

    images = convert_from_bytes(file_bytes)
    text_parts = []
    for img in images:
        text_parts.append(pytesseract.image_to_string(img))
    return "\n".join(text_parts)


def _extract_text_from_docx(file_bytes: bytes) -> str:
    """Extract text from a DOCX file."""
    from docx import Document

    doc = Document(io.BytesIO(file_bytes))
    return "\n".join(p.text for p in doc.paragraphs if p.text.strip())


def _extract_text_from_image(file_bytes: bytes) -> str:
    """OCR an image file using pytesseract."""
    import pytesseract
    from PIL import Image

    img = Image.open(io.BytesIO(file_bytes))
    return pytesseract.image_to_string(img)


def _extract_text(file_bytes: bytes, mime_type: str) -> str:
    """
    Extract text from file bytes based on mime type.
    - PDF (including Google Workspace exports): PyPDF2 + OCR fallback
    - DOCX: python-docx
    - Images: pytesseract
    - Other: UTF-8 decode
    """
    # PDF or Google Workspace (already exported as PDF by download_file_content)
    if mime_type in (
        "application/pdf",
        "application/vnd.google-apps.document",
        "application/vnd.google-apps.spreadsheet",
        "application/vnd.google-apps.presentation",
    ):
        return _extract_text_from_pdf(file_bytes)

    # DOCX
    if mime_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        return _extract_text_from_docx(file_bytes)

    # Images
    if mime_type in ("image/jpeg", "image/png", "image/tiff", "image/bmp"):
        return _extract_text_from_image(file_bytes)

    # Fallback: decode as UTF-8
    try:
        return file_bytes.decode("utf-8", errors="replace")
    except Exception:
        return file_bytes.decode("latin-1", errors="replace")


# ------------------------------------------------------------------
# LLM classification
# ------------------------------------------------------------------

_CLASSIFICATION_PROMPT = """\
You are a document classifier for a law school application system.
Read the following document text and identify the document type.

Classify into EXACTLY one of these types:
- CAS       : Character and Fitness / CAS report from LSAC
- EAPP      : Electronic application / law school application form
- LOR       : Letter of Recommendation
- TRANSCRIPT: Academic transcript or grade report
- GRADE_SHEET: Individual grade sheet or mark sheet
- ID_PROOF  : Government-issued ID, passport, or identity document
- RESUME    : Resume or CV
- STATEMENT : Personal statement or statement of purpose
- RECOMMENDATION: Recommendation letter (if different from LOR)
- UNKNOWN   : Cannot determine document type

Return ONLY this JSON:
{{"doc_type": "<TYPE>"}}

Document text:
---
{text}
---"""


def _classify_text(text: str) -> str:
    """Send extracted text to Azure OpenAI and return the doc_type string."""
    llm = _get_llm()

    truncated = text[:3000]
    messages = [
        SystemMessage(content="You classify legal and academic documents. Reply only with valid JSON."),
        HumanMessage(content=_CLASSIFICATION_PROMPT.format(text=truncated)),
    ]

    try:
        response = llm.invoke(messages)
        raw = response.content.strip()
    except Exception:
        return "UNKNOWN"

    # Handle markdown code blocks
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)

    try:
        data = json.loads(raw)
        doc_type = str(data.get("doc_type", "UNKNOWN")).strip().upper()
    except (json.JSONDecodeError, AttributeError):
        return "UNKNOWN"

    valid_types = {
        "CAS", "EAPP", "LOR", "TRANSCRIPT", "GRADE_SHEET",
        "ID_PROOF", "RESUME", "STATEMENT", "RECOMMENDATION", "UNKNOWN",
    }
    return doc_type if doc_type in valid_types else "UNKNOWN"


# ------------------------------------------------------------------
# Public API
# ------------------------------------------------------------------

def detect_doc_type(file_bytes: bytes, mime_type: str) -> str:
    """
    Detect document type from file content using OCR + LLM.

    Steps:
      1. Extract text based on mime_type (PDF, DOCX, image, or fallback).
      2. Classify using Azure OpenAI.
      3. Return doc_type string (e.g. "CAS", "LOR", "UNKNOWN").
    """
    try:
        text = _extract_text(file_bytes, mime_type)
    except Exception:
        return "UNKNOWN"

    if not text or len(text.strip()) < 10:
        return "UNKNOWN"

    return _classify_text(text)
