# File Rename Functionality - Integration Guide

## Overview

This document provides the complete code and instructions to integrate the **Google Drive File Rename** functionality into another codebase. The system renames and organizes files based on student information, using Azure OpenAI for intelligent document analysis via LangGraph.

---

## Architecture

```
┌─────────────────────┐    ┌─────────────────────┐    ┌─────────────────────┐
│   FastAPI Server    │───▶│  Google Drive API   │───▶│  Source Folder      │
│   (app.py)          │    │  (drive_handler.py) │    │  (Files to rename)  │
└─────────────────────┘    └─────────────────────┘    └─────────────────────┘
         │                          │
         │                          ▼
         │                 ┌─────────────────────┐
         │                 │  Destination Folder │
         │                 │  (rename_document/) │
         │                 └─────────────────────┘
         │
         ▼
┌─────────────────────┐    ┌─────────────────────┐
│  LangGraph Pipeline │───▶│  Azure OpenAI       │
│  (renamer.py)       │    │  (Text Extraction)  │
└─────────────────────┘    └─────────────────────┘
```

---

## Dependencies

```txt
# requirements.txt
google-api-python-client==2.126.0
google-auth-httplib2==0.2.0
google-auth-oauthlib==1.2.0
python-dotenv==1.0.1
openai>=1.30.0
PyPDF2>=3.0.0
python-docx>=1.1.0
fastapi>=0.111.0
uvicorn>=0.30.0
gunicorn>=22.0.0
langgraph>=1.0.0
langchain-openai>=1.0.0
langchain-core>=1.0.0
```

---

## Environment Variables

```env
# .env file
# Azure OpenAI Settings
AZURE_OPENAI_API_KEY=your_azure_openai_api_key
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
AZURE_OPENAI_API_VERSION=2024-02-15-preview
AZURE_OPENAI_DEPLOYMENT_NAME=gpt-4o-mini

# Google Drive Settings
GOOGLE_SOURCE_FOLDER_ID=your_source_folder_id
GOOGLE_API_KEY=your_google_api_key
GOOGLE_CREDENTIALS_FILE=path/to/credentials.json

# Optional: For Azure App Service deployment
GOOGLE_TOKEN_JSON={"token": "...", "refresh_token": "...", ...}
```

---

## Core Files

### 1. config.py - Configuration Management

```python
"""
config.py – Configuration settings for the rename service.
"""

import os
from dotenv import load_dotenv

load_dotenv()

# Azure OpenAI settings
AZURE_OPENAI_API_KEY = os.getenv("AZURE_OPENAI_API_KEY", "").strip()
AZURE_OPENAI_ENDPOINT = os.getenv("AZURE_OPENAI_ENDPOINT", "").strip()
AZURE_OPENAI_API_VERSION = os.getenv("AZURE_OPENAI_API_VERSION", "2024-02-15-preview").strip()
AZURE_OPENAI_DEPLOYMENT_NAME = os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME", "gpt-4o-mini").strip()

# Google Drive settings
SOURCE_FOLDER_ID = os.getenv("GOOGLE_SOURCE_FOLDER_ID", "your_default_folder_id")
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "")
DESTINATION_FOLDER_NAME = "rename_document"

# Credential file path
_HERE = os.path.dirname(os.path.abspath(__file__))
CREDENTIALS_FILE = os.getenv(
    "GOOGLE_CREDENTIALS_FILE",
    os.path.join(_HERE, "client_secret.json"),
)
TOKEN_FILE = os.path.join(_HERE, "token.json")

# Extraction mode: "filename" | "sheet"
EXTRACTION_MODE = "filename"

# Google Sheets settings (if using sheet mode)
SHEET_ID = "YOUR_GOOGLE_SHEET_ID"
SHEET_TAB = "Sheet1"
COL_ORIGINAL_FILENAME = 1
COL_STUDENT_ID = 2
COL_STUDENT_NAME = 3

# Whether to trash original files after processing
DELETE_ORIGINAL = False
```

---

### 2. drive_service.py - Google Drive Authentication

```python
"""
Google Drive API service initialization.

Supports credential strategies, tried in order:
    1. GOOGLE_TOKEN_JSON env var (recommended for Azure App Service)
    2. token.json file (written after successful auth)
    3. Service Account JSON file
    4. OAuth2 desktop-app flow (local dev only)
"""

import json
import os
import tempfile

from google.auth.transport.requests import Request
from google.oauth2 import service_account
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

import config

SCOPES = ["https://www.googleapis.com/auth/drive"]


def _is_service_account(cred_path: str) -> bool:
    """Return True when the JSON file is a service-account key."""
    with open(cred_path) as f:
        data = json.load(f)
    return data.get("type") == "service_account"


def _write_token(creds: Credentials) -> None:
    """Persist credentials to token.json."""
    try:
        with open(config.TOKEN_FILE, "w") as f:
            f.write(creds.to_json())
    except OSError:
        pass


def get_drive_service():
    """Build and return an authenticated Drive v3 service object."""

    # Strategy 1: GOOGLE_TOKEN_JSON env var (primary Azure path)
    token_env = os.getenv("GOOGLE_TOKEN_JSON", "").strip()
    if token_env:
        try:
            creds = Credentials.from_authorized_user_info(json.loads(token_env), SCOPES)
            if creds.expired and creds.refresh_token:
                creds.refresh(Request())
            _write_token(creds)
            return build("drive", "v3", credentials=creds)
        except Exception as exc:
            raise RuntimeError(
                f"GOOGLE_TOKEN_JSON env var could not be parsed or refreshed: {exc}"
            ) from exc

    # Strategy 2: token.json file
    if os.path.exists(config.TOKEN_FILE):
        creds = Credentials.from_authorized_user_file(config.TOKEN_FILE, SCOPES)
        if creds.valid:
            return build("drive", "v3", credentials=creds)
        if creds.expired and creds.refresh_token:
            creds.refresh(Request())
            _write_token(creds)
            return build("drive", "v3", credentials=creds)

    # Strategy 3: service account JSON file
    cred_path = config.CREDENTIALS_FILE
    if not os.path.exists(cred_path):
        raise FileNotFoundError(
            "No Google credentials found.\n"
            "  On Azure: set the GOOGLE_TOKEN_JSON App Setting.\n"
            f"  Locally: ensure '{cred_path}' or 'token.json' exists."
        )

    if _is_service_account(cred_path):
        creds = service_account.Credentials.from_service_account_file(
            cred_path, scopes=SCOPES
        )
        return build("drive", "v3", credentials=creds)

    # Strategy 4: OAuth2 desktop flow (local dev only)
    from google_auth_oauthlib.flow import InstalledAppFlow
    flow = InstalledAppFlow.from_client_secrets_file(cred_path, SCOPES)
    creds = flow.run_local_server(port=0)
    _write_token(creds)
    return build("drive", "v3", credentials=creds)
```

---

### 3. drive_handler.py - Drive File Operations

```python
"""
Helpers to list, rename, move and trash files via the Drive v3 API.
"""

import io
from googleapiclient.errors import HttpError
from googleapiclient.http import MediaIoBaseDownload
import config


# ── Folder Operations ──

def get_or_create_folder(service, folder_name: str, parent_folder_id: str) -> str:
    """
    Return the ID of a folder named *folder_name* inside *parent_folder_id*.
    Creates the folder if it does not already exist.
    """
    query = (
        f"name = '{folder_name}' "
        f"and '{parent_folder_id}' in parents "
        f"and mimeType = 'application/vnd.google-apps.folder' "
        f"and trashed = false"
    )
    response = (
        service.files()
        .list(q=query, spaces="drive", fields="files(id, name)")
        .execute()
    )
    files = response.get("files", [])
    if files:
        return files[0]["id"]

    metadata = {
        "name": folder_name,
        "mimeType": "application/vnd.google-apps.folder",
        "parents": [parent_folder_id],
    }
    folder = service.files().create(body=metadata, fields="id").execute()
    return folder["id"]


# ── Listing ──

def list_files_in_folder(service, folder_id: str) -> list[dict]:
    """Return all files (not folders) in the given Drive folder."""
    results = []
    page_token = None
    query = f"'{folder_id}' in parents and mimeType != 'application/vnd.google-apps.folder' and trashed = false"

    while True:
        response = (
            service.files()
            .list(
                q=query,
                spaces="drive",
                fields="nextPageToken, files(id, name, mimeType)",
                pageToken=page_token,
            )
            .execute()
        )
        results.extend(response.get("files", []))
        page_token = response.get("nextPageToken")
        if not page_token:
            break

    return results


# ── Rename ──

def rename_file(service, file_id: str, new_name: str) -> dict:
    """Rename a file in Drive by updating its name metadata."""
    return (
        service.files()
        .update(fileId=file_id, body={"name": new_name}, fields="id, name")
        .execute()
    )


# ── Move ──

def move_file(service, file_id: str, source_folder_id: str, destination_folder_id: str) -> dict:
    """Move a file from source_folder_id to destination_folder_id."""
    return (
        service.files()
        .update(
            fileId=file_id,
            addParents=destination_folder_id,
            removeParents=source_folder_id,
            fields="id, name, webViewLink",
        )
        .execute()
    )


# ── Student File Search ──

def find_student_files_in_folder(service, student_id: str, student_name: str,
                                  folder_id: str) -> list[dict]:
    """Search folder for files matching student_id and student_name."""
    query = (
        f"name contains '{student_id}_' "
        f"and '{folder_id}' in parents "
        f"and trashed = false "
        f"and mimeType != 'application/vnd.google-apps.folder'"
    )
    response = (
        service.files()
        .list(q=query, spaces="drive", fields="files(id, name)")
        .execute()
    )
    files = response.get("files", [])

    name_normalized = student_name.lower().replace(" ", "_")
    prefix = f"{student_id}_{name_normalized}".lower()
    return [
        f for f in files
        if f["name"].lower().replace(" ", "_").startswith(prefix)
    ]


def find_matching_doc_in_folder(service, student_id: str, student_name: str,
                                 doc_type: str, folder_id: str) -> dict | None:
    """Find a file matching student + doc_type in folder."""
    student_files = find_student_files_in_folder(service, student_id, student_name, folder_id)
    doc_type_lower = doc_type.lower()
    for f in student_files:
        if doc_type_lower in f["name"].lower():
            return f
    return None


def student_exists_in_rename_folder(service, student_id: str, student_name: str,
                                     rename_folder_id: str) -> bool:
    """Returns True if any file for this student exists in rename folder."""
    files = find_student_files_in_folder(service, student_id, student_name, rename_folder_id)
    return len(files) > 0


# ── Trash ──

def trash_file(service, file_id: str) -> None:
    """Move a file to the Drive trash."""
    service.files().update(fileId=file_id, body={"trashed": True}).execute()


# ── Download Content ──

_EXPORT_MAP = {
    "application/vnd.google-apps.document": "application/pdf",
    "application/vnd.google-apps.spreadsheet": "application/pdf",
    "application/vnd.google-apps.presentation": "application/pdf",
}


def download_file_content(service, file_id: str, mime_type: str) -> bytes:
    """
    Download file bytes from Drive.
    For Google Workspace files, exports as PDF.
    For regular files, downloads directly.
    """
    export_mime = _EXPORT_MAP.get(mime_type)

    if export_mime:
        request = service.files().export_media(fileId=file_id, mimeType=export_mime)
    else:
        request = service.files().get_media(fileId=file_id)

    buffer = io.BytesIO()
    downloader = MediaIoBaseDownload(buffer, request)
    done = False
    while not done:
        _, done = downloader.next_chunk()

    return buffer.getvalue()
```

---

### 4. app.py - FastAPI REST API

```python
"""
FastAPI – Student Document Organizer

POST /rename/student
  Input: student_name, student_id
  Action: Find files, rename them, move to destination folder
"""

import re
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import config
import drive_handler as dh
from drive_service import get_drive_service
from googleapiclient.errors import HttpError

app = FastAPI(title="Drive Student File Renamer", redirect_slashes=True)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_service = None


def _get_service():
    global _service
    if _service is None:
        _service = get_drive_service()
    return _service


def _reset_service():
    global _service
    _service = None


def _extract_doc_type(original_name: str) -> str:
    """Extract document type from filename."""
    name_no_ext = original_name.rsplit(".", 1)[0] if "." in original_name else original_name
    name_no_ext = re.sub(r'\s*\(\d+\)\s*$', '', name_no_ext).strip()

    known_types = ["eapp", "cas", "lor", "transcript", "resume", "cv", "sop"]
    tokens = re.split(r'[\s_\-]+', name_no_ext)

    for token in reversed(tokens):
        if token.lower() in known_types:
            return token
    if tokens:
        return tokens[-1]
    return "doc"


# ── Request/Response Models ──

class StudentRequest(BaseModel):
    student_name: str
    student_id: str


class FileResult(BaseModel):
    original_name: str
    new_name: str
    file_id: str
    action: str  # "moved" | "replaced" | "added"
    web_link: str | None = None
    replaced_old_file_id: str | None = None


class StudentResponse(BaseModel):
    status: str
    student_name: str
    student_id: str
    detected_case: str
    matched_count: int
    processed_count: int
    results: list[FileResult]
    errors: list[str]


# ── API Endpoint ──

@app.post("/rename/student", response_model=StudentResponse)
def rename_student(req: StudentRequest):
    """Search for files matching student name and rename/move them."""
    student_name = req.student_name.strip()
    student_id = req.student_id.strip()

    if not student_name or not student_id:
        raise HTTPException(status_code=400, detail="student_name and student_id are required.")

    try:
        service = _get_service()
    except (FileNotFoundError, RuntimeError) as exc:
        raise HTTPException(status_code=503, detail=f"Google Drive auth failed: {exc}")

    # List files in source folder
    try:
        files = dh.list_files_in_folder(service, config.SOURCE_FOLDER_ID)
    except HttpError as exc:
        if exc.resp.status in (401, 403):
            _reset_service()
            raise HTTPException(status_code=503, detail=f"Google Drive HTTP {exc.resp.status}")
        raise HTTPException(status_code=502, detail=f"Google Drive API error: {exc}")

    if not files:
        return StudentResponse(
            status="not_found",
            student_name=student_name,
            student_id=student_id,
            detected_case="new",
            matched_count=0,
            processed_count=0,
            results=[],
            errors=["No files found in source folder."],
        )

    # Filter files matching student
    name_term = student_name.lower()
    id_term = student_id.lower()
    matched_files = [
        f for f in files
        if name_term in f["name"].lower() or id_term in f["name"].lower()
    ]

    if not matched_files:
        rename_folder_id = dh.get_or_create_folder(service, config.DESTINATION_FOLDER_NAME, "root")
        already_renamed = dh.student_exists_in_rename_folder(service, student_id, student_name, rename_folder_id)
        
        if already_renamed:
            return StudentResponse(
                status="already_renamed",
                student_name=student_name,
                student_id=student_id,
                detected_case="none",
                matched_count=0,
                processed_count=0,
                results=[],
                errors=["Already renamed, no new docs."],
            )
        return StudentResponse(
            status="not_found",
            student_name=student_name,
            student_id=student_id,
            detected_case="new",
            matched_count=0,
            processed_count=0,
            results=[],
            errors=[f"No documents found for '{student_name}' (ID: {student_id})."],
        )

    # Ensure destination folder exists
    rename_folder_id = dh.get_or_create_folder(service, config.DESTINATION_FOLDER_NAME, "root")

    # Detect case: NEW or UPDATE
    is_update = dh.student_exists_in_rename_folder(service, student_id, student_name, rename_folder_id)
    detected_case = "update" if is_update else "new"

    # Process each matched file
    results: list[FileResult] = []
    errors: list[str] = []
    student_name_normalized = student_name.replace(" ", "_")

    for file in matched_files:
        file_id = file["id"]
        original_name = file["name"]

        ext = ""
        if "." in original_name:
            ext = "." + original_name.rsplit(".", 1)[1]

        doc_type = _extract_doc_type(original_name)
        new_name = f"{student_id}_{student_name_normalized}_{doc_type}{ext}"

        try:
            if detected_case == "update":
                old_file = dh.find_matching_doc_in_folder(
                    service, student_id, student_name, doc_type, rename_folder_id
                )
                if old_file:
                    dh.trash_file(service, old_file["id"])
                    dh.rename_file(service, file_id, new_name)
                    moved = dh.move_file(service, file_id, config.SOURCE_FOLDER_ID, rename_folder_id)
                    results.append(FileResult(
                        original_name=original_name,
                        new_name=new_name,
                        file_id=moved["id"],
                        action="replaced",
                        web_link=moved.get("webViewLink"),
                        replaced_old_file_id=old_file["id"],
                    ))
                else:
                    dh.rename_file(service, file_id, new_name)
                    moved = dh.move_file(service, file_id, config.SOURCE_FOLDER_ID, rename_folder_id)
                    results.append(FileResult(
                        original_name=original_name,
                        new_name=new_name,
                        file_id=moved["id"],
                        action="added",
                        web_link=moved.get("webViewLink"),
                    ))
            else:
                dh.rename_file(service, file_id, new_name)
                moved = dh.move_file(service, file_id, config.SOURCE_FOLDER_ID, rename_folder_id)
                results.append(FileResult(
                    original_name=original_name,
                    new_name=new_name,
                    file_id=moved["id"],
                    action="moved",
                    web_link=moved.get("webViewLink"),
                ))
        except Exception as exc:
            errors.append(f"[ERROR] Failed to process '{original_name}': {exc}")

    return StudentResponse(
        status="success" if results else "no_files_processed",
        student_name=student_name,
        student_id=student_id,
        detected_case=detected_case,
        matched_count=len(matched_files),
        processed_count=len(results),
        results=results,
        errors=errors,
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
```

---

### 5. renamer.py - LangGraph AI Pipeline (Optional)

```python
"""
LangGraph-based document analysis pipeline using Azure OpenAI.

Graph nodes:
  1. extract_text_node  – Extract text from PDF/DOCX bytes
  2. llm_extract_node   – Use Azure OpenAI to extract account number & student name
  3. build_output_node  – Build folder name from account number
"""

import re
import json
import io
from typing import TypedDict

from langchain_openai import AzureChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage
from langgraph.graph import StateGraph, START, END
import config


class DocState(TypedDict):
    file_bytes: bytes
    mime_type: str
    document_text: str
    account_number: str
    student_full_name: str
    folder_name: str
    error: str


_UNSAFE = re.compile(r'[\\/:*?"<>|]')


def _sanitise(text: str) -> str:
    return _UNSAFE.sub("_", text).strip()


def extract_text_node(state: DocState) -> dict:
    """Extract readable text from file bytes based on MIME type."""
    file_bytes = state["file_bytes"]
    mime_type = state["mime_type"]
    text = ""

    # PDF
    if mime_type in ("application/pdf", "application/vnd.google-apps.document"):
        try:
            from PyPDF2 import PdfReader
            reader = PdfReader(io.BytesIO(file_bytes))
            text_parts = [page.extract_text() for page in reader.pages if page.extract_text()]
            text = "\n".join(text_parts)
        except Exception as e:
            return {"error": f"PDF extraction error: {e}"}

    # DOCX
    elif mime_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        try:
            from docx import Document
            doc = Document(io.BytesIO(file_bytes))
            text = "\n".join(p.text for p in doc.paragraphs if p.text.strip())
        except Exception as e:
            return {"error": f"DOCX extraction error: {e}"}

    # Plain text / CSV / HTML
    elif mime_type and ("text/" in mime_type or mime_type == "application/csv"):
        try:
            text = file_bytes.decode("utf-8", errors="replace")
        except Exception:
            text = file_bytes.decode("latin-1", errors="replace")

    # Fallback
    else:
        try:
            text = file_bytes.decode("utf-8", errors="replace")[:5000]
        except Exception:
            return {"error": "Could not extract text from this file type"}

    if not text.strip():
        return {"error": "No text content found in document"}

    return {"document_text": text}


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


def llm_extract_node(state: DocState) -> dict:
    """Use Azure OpenAI to extract account_number + student_full_name."""
    if state.get("error"):
        return {}

    document_text = state["document_text"]
    truncated_text = document_text[:4000]

    llm = _get_llm()

    messages = [
        SystemMessage(content="You extract structured data from legal/academic documents. Always respond with valid JSON only."),
        HumanMessage(content=(
            "Extract from this document:\n"
            "1. Account Number (LSAC Acct #, starts with 'L' + digits)\n"
            "2. Student Full Name\n\n"
            "Return JSON: {\"account_number\": \"...\", \"student_full_name\": \"...\"}\n\n"
            f"Document:\n---\n{truncated_text}\n---"
        )),
    ]

    try:
        response = llm.invoke(messages)
        raw = response.content.strip()
    except Exception as e:
        return {"error": f"LLM call failed: {e}"}

    # Parse JSON
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {"error": f"LLM returned invalid JSON: {raw}"}

    account_number = str(data.get("account_number", "UNKNOWN")).strip()
    student_full_name = str(data.get("student_full_name", "UNKNOWN")).strip()

    if account_number == "UNKNOWN":
        return {"error": "Could not find account number in document."}

    # Strip leading 'L'
    if account_number.upper().startswith("L") and account_number[1:].isdigit():
        account_number = account_number[1:]

    return {
        "account_number": account_number,
        "student_full_name": student_full_name,
    }


def build_output_node(state: DocState) -> dict:
    """Build folder name from account number."""
    if state.get("error"):
        return {}
    account_number = state["account_number"]
    folder_name = _sanitise(account_number).replace(" ", "")
    return {"folder_name": folder_name}


def should_continue(state: DocState) -> str:
    return "end" if state.get("error") else "llm_extract"


def should_build(state: DocState) -> str:
    return "end" if state.get("error") else "build_output"


def _build_graph() -> StateGraph:
    graph = StateGraph(DocState)
    graph.add_node("extract_text", extract_text_node)
    graph.add_node("llm_extract", llm_extract_node)
    graph.add_node("build_output", build_output_node)

    graph.add_edge(START, "extract_text")
    graph.add_conditional_edges("extract_text", should_continue, {
        "llm_extract": "llm_extract",
        "end": END,
    })
    graph.add_conditional_edges("llm_extract", should_build, {
        "build_output": "build_output",
        "end": END,
    })
    graph.add_edge("build_output", END)

    return graph.compile()


_compiled_graph = None


def get_graph():
    global _compiled_graph
    if _compiled_graph is None:
        _compiled_graph = _build_graph()
    return _compiled_graph


def process_document(file_bytes: bytes, mime_type: str) -> dict:
    """Run the LangGraph pipeline on a single document."""
    graph = get_graph()

    initial_state: DocState = {
        "file_bytes": file_bytes,
        "mime_type": mime_type,
        "document_text": "",
        "account_number": "",
        "student_full_name": "",
        "folder_name": "",
        "error": "",
    }

    return graph.invoke(initial_state)
```

---

## API Usage

### Rename Student Documents

**Request:**
```http
POST /rename/student
Content-Type: application/json

{
  "student_name": "John Doe",
  "student_id": "12345678"
}
```

**Response:**
```json
{
  "status": "success",
  "student_name": "John Doe",
  "student_id": "12345678",
  "detected_case": "new",
  "matched_count": 2,
  "processed_count": 2,
  "results": [
    {
      "original_name": "John Doe Transcript.pdf",
      "new_name": "12345678_John_Doe_Transcript.pdf",
      "file_id": "abc123",
      "action": "moved",
      "web_link": "https://drive.google.com/file/d/abc123/view"
    }
  ],
  "errors": []
}
```

---

## Running the Service

```bash
# Install dependencies
pip install -r requirements.txt

# Run with uvicorn
uvicorn app:app --host 0.0.0.0 --port 8001 --reload

# Or run directly
python app.py
```

---

## Deployment Notes

### Azure App Service
1. Set `GOOGLE_TOKEN_JSON` App Setting to the full JSON contents of your `token.json`
2. Set all Azure OpenAI environment variables
3. Set `GOOGLE_SOURCE_FOLDER_ID` to your Drive folder ID

### Local Development
1. Place `client_secret.json` in the project root
2. Run the app - it will open a browser for OAuth flow
3. `token.json` will be created after successful auth
