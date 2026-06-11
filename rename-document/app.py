"""
FastAPI – Student Document Renamer (OCR + LLM)

Endpoint:
  POST /rename/student
    Input : { student_name, student_id }
    Action:
      1. Find the student's own folder in Google Drive (named by student_id).
      2. List all files in that folder.
      3. Auto-detect NEW vs UPDATE case.
      4. For each unprocessed file: OCR → LLM classify → rename in-place.
"""

import os

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import drive_handler as dh
import renamer
from drive_service import get_drive_service

app = FastAPI(title="Drive Student File Renamer", redirect_slashes=True)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Build the Drive service once (lazy singleton)
_service = None


def _get_service():
    global _service
    if _service is None:
        _service = get_drive_service()
    return _service


# ── Request / Response models ────────────────────────────────────

class StudentRequest(BaseModel):
    student_name: str
    student_id: str


class FileResult(BaseModel):
    original_name: str
    new_name: str
    doc_type: str
    action: str  # "renamed" | "replaced" | "added"
    web_link: str | None = None


class StudentResponse(BaseModel):
    status: str
    student_name: str
    student_id: str
    detected_case: str  # "new" | "update"
    processed_count: int
    results: list[FileResult]
    errors: list[str]


# ── POST /rename/student ─────────────────────────────────────────

@app.post("/rename/student", response_model=StudentResponse)
def rename_student(req: StudentRequest):
    service = _get_service()
    student_name = req.student_name.strip()
    student_id = req.student_id.strip()

    if not student_name or not student_id:
        raise HTTPException(status_code=400, detail="student_name and student_id are required.")

    # 1. Find the student's folder in Google Drive
    folder_id = dh.get_student_folder_id(service, student_id)
    if not folder_id:
        raise HTTPException(
            status_code=404,
            detail=f"No folder found in Google Drive for student_id '{student_id}'",
        )

    # 2. List all files in the student's folder
    files = dh.list_files_in_folder(service, folder_id)
    if not files:
        return StudentResponse(
            status="nothing_to_process",
            student_name=student_name,
            student_id=student_id,
            detected_case="new",
            processed_count=0,
            results=[],
            errors=["No files found in the student's folder."],
        )

    # 3. Auto-detect case
    prefix = f"{student_id}_"
    unprocessed = [f for f in files if not f["name"].startswith(prefix)]
    already_renamed = [f for f in files if f["name"].startswith(prefix)]
    detected_case = "update" if already_renamed else "new"

    if not unprocessed:
        return StudentResponse(
            status="nothing_to_process",
            student_name=student_name,
            student_id=student_id,
            detected_case=detected_case,
            processed_count=0,
            results=[],
            errors=[],
        )

    # 4. Process each unprocessed file
    results: list[FileResult] = []
    errors: list[str] = []
    normalized_name = student_name.strip().replace(" ", "_")

    for file in unprocessed:
        file_id = file["id"]
        original_name = file["name"]
        mime_type = file.get("mimeType", "")

        try:
            # Download file bytes
            file_bytes = dh.download_file_content(service, file_id, mime_type)

            # For Google Workspace files, content was exported as PDF
            extract_mime = (
                "application/pdf"
                if mime_type.startswith("application/vnd.google-apps.")
                else mime_type
            )

            # Detect document type via OCR + LLM
            doc_type = renamer.detect_doc_type(file_bytes, extract_mime)

            # Build new filename
            ext = os.path.splitext(original_name)[1] or ".pdf"
            new_name = f"{student_id}_{normalized_name}_{doc_type}{ext}"

            # Determine action
            if detected_case == "update":
                old_file = dh.find_existing_doc_type(service, student_id, doc_type, folder_id)
                if old_file:
                    dh.trash_file(service, old_file["id"])
                    action = "replaced"
                else:
                    action = "added"
            else:
                action = "renamed"

            # Rename in-place
            updated = dh.rename_file_inplace(service, file_id, new_name)

            results.append(FileResult(
                original_name=original_name,
                new_name=new_name,
                doc_type=doc_type,
                action=action,
                web_link=updated.get("webViewLink"),
            ))

        except Exception as exc:
            errors.append(f"Failed to process '{original_name}': {exc}")

    return StudentResponse(
        status="success" if results else "no_files_processed",
        student_name=student_name,
        student_id=student_id,
        detected_case=detected_case,
        processed_count=len(results),
        results=results,
        errors=errors,
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
