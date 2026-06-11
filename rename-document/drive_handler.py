"""
Helpers for Google Drive v3 API operations:
  - Find student folder by student_id
  - List files in a folder
  - Rename file in-place
  - Find existing file by doc_type
  - Trash a file
  - Download / export file content
"""

import io

from googleapiclient.http import MediaIoBaseDownload


# ------------------------------------------------------------------
# Folder lookup
# ------------------------------------------------------------------

def get_student_folder_id(service, student_id: str) -> str | None:
    """
    Search Google Drive for a folder named exactly student_id
    inside the 'input documents' folder.
    Returns folder_id if found, else None.
    """
    # First, find the "input documents" parent folder
    parent_query = (
        "name = 'input documents' "
        "and mimeType = 'application/vnd.google-apps.folder' "
        "and trashed = false"
    )
    parent_response = (
        service.files()
        .list(q=parent_query, spaces="drive", fields="files(id, name)")
        .execute()
    )
    parent_files = parent_response.get("files", [])
    if not parent_files:
        return None
    parent_folder_id = parent_files[0]["id"]

    # Then, find the student folder inside "input documents"
    query = (
        f"name = '{student_id}' "
        f"and mimeType = 'application/vnd.google-apps.folder' "
        f"and '{parent_folder_id}' in parents "
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
    return None


# ------------------------------------------------------------------
# Listing
# ------------------------------------------------------------------

def list_files_in_folder(service, folder_id: str) -> list[dict]:
    """Return all files (not folders) in the given Drive folder."""
    results = []
    page_token = None
    query = (
        f"'{folder_id}' in parents "
        f"and mimeType != 'application/vnd.google-apps.folder' "
        f"and trashed = false"
    )

    while True:
        response = (
            service.files()
            .list(
                q=query,
                spaces="drive",
                fields="nextPageToken, files(id, name, mimeType, webViewLink)",
                pageToken=page_token,
            )
            .execute()
        )
        results.extend(response.get("files", []))
        page_token = response.get("nextPageToken")
        if not page_token:
            break

    return results


# ------------------------------------------------------------------
# Rename file in-place
# ------------------------------------------------------------------

def rename_file_inplace(service, file_id: str, new_name: str) -> dict:
    """
    Rename a file in Drive by updating its name metadata.
    Returns updated file metadata with id, name, webViewLink.
    """
    updated = (
        service.files()
        .update(
            fileId=file_id,
            body={"name": new_name},
            fields="id, name, webViewLink",
        )
        .execute()
    )
    return updated


# ------------------------------------------------------------------
# Find existing file by doc_type in student's folder
# ------------------------------------------------------------------

def find_existing_doc_type(service, student_id: str, doc_type: str, folder_id: str) -> dict | None:
    """
    Find a file in folder_id whose name starts with '<student_id>_'
    and contains '_<doc_type>.' (case-insensitive).
    Returns the file dict if found, else None.
    """
    query = (
        f"name contains '{student_id}_' "
        f"and '{folder_id}' in parents "
        f"and trashed = false "
        f"and mimeType != 'application/vnd.google-apps.folder'"
    )
    response = (
        service.files()
        .list(q=query, spaces="drive", fields="files(id, name, mimeType)")
        .execute()
    )
    files = response.get("files", [])

    doc_type_lower = doc_type.lower()
    for f in files:
        name_lower = f["name"].lower()
        if name_lower.startswith(f"{student_id.lower()}_") and f"_{doc_type_lower}." in name_lower:
            return f
    return None


# ------------------------------------------------------------------
# Trashing
# ------------------------------------------------------------------

def trash_file(service, file_id: str) -> None:
    """Move a file to the Drive trash."""
    service.files().update(fileId=file_id, body={"trashed": True}).execute()


# ------------------------------------------------------------------
# Download / export file content for text extraction
# ------------------------------------------------------------------

_EXPORT_MAP = {
    "application/vnd.google-apps.document": "application/pdf",
    "application/vnd.google-apps.spreadsheet": "application/pdf",
    "application/vnd.google-apps.presentation": "application/pdf",
}


def download_file_content(service, file_id: str, mime_type: str) -> bytes:
    """
    Download file bytes from Drive.
    For Google Workspace files (Docs, Sheets, Slides), exports as PDF.
    For regular files (PDF, DOCX, etc.), downloads directly.
    Returns raw bytes.
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
