from drive_service import get_drive_service

service = get_drive_service()
query = "mimeType='application/vnd.google-apps.folder' and name='student documents' and trashed=false"
res = service.files().list(q=query, spaces="drive", fields="files(id,name)").execute()
folders = res.get("files", [])
if folders:
    for f in folders:
        print(f"Found: '{f['name']}' -> ID: {f['id']}")
else:
    print("No folder named 'student documents' found in this account.")
    print("\nListing ALL folders in My Drive root:")
    res2 = service.files().list(
        q="mimeType='application/vnd.google-apps.folder' and 'root' in parents and trashed=false",
        spaces="drive", fields="files(id,name)"
    ).execute()
    for f in res2.get("files", []):
        print(f"  '{f['name']}' -> {f['id']}")
