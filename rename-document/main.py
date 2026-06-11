"""
main.py – CLI entry point. Run with: python main.py

Flow:
  1. Authenticate with Google Drive.
  2. Prompt for student_id and student_name.
  3. Find the student's folder (named by student_id).
  4. Auto-detect NEW vs UPDATE case.
  5. For each unprocessed file: download → OCR → LLM classify → rename in-place.
"""

import os
import sys

import drive_handler as dh
import renamer
from drive_service import get_drive_service


def main():
    print("=" * 60)
    print("  Student Document Renamer (OCR + LLM)")
    print("=" * 60)

    # Get student info
    student_id = input("\nEnter student_id: ").strip()
    student_name = input("Enter student_name: ").strip()

    if not student_id or not student_name:
        print("[ERROR] student_id and student_name are required.")
        sys.exit(1)

    # 1. Authenticate
    print("\n[1/4] Authenticating with Google Drive…")
    service = get_drive_service()

    # 2. Find student folder
    print(f"\n[2/4] Looking up folder for student_id: {student_id}")
    folder_id = dh.get_student_folder_id(service, student_id)
    if not folder_id:
        print(f"[ERROR] No folder found in Google Drive for student_id '{student_id}'")
        sys.exit(1)
    print(f"  Found folder ID: {folder_id}")

    # 3. List files in student's folder
    print(f"\n[3/4] Listing files in student folder…")
    files = dh.list_files_in_folder(service, folder_id)

    if not files:
        print("  No files found in the student's folder. Exiting.")
        return

    print(f"  Found {len(files)} file(s).")

    # 4. Auto-detect case
    prefix = f"{student_id}_"
    unprocessed = [f for f in files if not f["name"].startswith(prefix)]
    already_renamed = [f for f in files if f["name"].startswith(prefix)]
    detected_case = "update" if already_renamed else "new"

    print(f"  Detected case: {detected_case.upper()}")
    print(f"  Already renamed: {len(already_renamed)}, Unprocessed: {len(unprocessed)}")

    if not unprocessed:
        print("\n  Nothing to process — all files are already renamed.")
        return

    # 5. Process each unprocessed file
    print(f"\n[4/4] Processing {len(unprocessed)} unprocessed file(s)…\n")

    normalized_name = student_name.strip().replace(" ", "_")
    success_count = 0
    error_count = 0

    for i, file in enumerate(unprocessed, 1):
        file_id = file["id"]
        original_name = file["name"]
        mime_type = file.get("mimeType", "")

        print(f"── File {i}/{len(unprocessed)}: '{original_name}' ──")

        try:
            # Download file bytes
            file_bytes = dh.download_file_content(service, file_id, mime_type)
            print(f"  Downloaded {len(file_bytes)} bytes")

            # For Google Workspace files, content was exported as PDF
            extract_mime = (
                "application/pdf"
                if mime_type.startswith("application/vnd.google-apps.")
                else mime_type
            )

            # Detect document type via OCR + LLM
            print("  Running OCR + LLM classification…")
            doc_type = renamer.detect_doc_type(file_bytes, extract_mime)
            print(f"  Detected doc_type: {doc_type}")

            # Build new filename
            ext = os.path.splitext(original_name)[1] or ".pdf"
            new_name = f"{student_id}_{normalized_name}_{doc_type}{ext}"

            # Determine action based on case
            if detected_case == "update":
                old_file = dh.find_existing_doc_type(service, student_id, doc_type, folder_id)
                if old_file:
                    dh.trash_file(service, old_file["id"])
                    action = "replaced"
                    print(f"  [UPDATE - REPLACED] Trashed old: '{old_file['name']}'")
                else:
                    action = "added"
                    print(f"  [UPDATE - ADDED] New doc type for this student")
            else:
                action = "renamed"

            # Rename in-place
            updated = dh.rename_file_inplace(service, file_id, new_name)
            print(f"  [{action.upper()}] '{original_name}' → '{new_name}'")
            if updated.get("webViewLink"):
                print(f"  Link: {updated['webViewLink']}")

            success_count += 1

        except Exception as exc:
            print(f"  [ERROR] {exc}")
            error_count += 1

        print()

    # Summary
    print("=" * 60)
    print(f"  Done.  Success: {success_count}  |  Errors: {error_count}")
    print("=" * 60)


if __name__ == "__main__":
    main()
