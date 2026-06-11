import urllib.request
import json

student_name = input("Enter student name: ")
student_id = input("Enter student ID: ")

req = urllib.request.Request(
    "http://localhost:8000/rename/student",
    data=json.dumps({
        "student_name": student_name,
        "student_id": student_id
    }).encode(),
    headers={"Content-Type": "application/json"},
    method="POST",
)

try:
    resp = urllib.request.urlopen(req)
    data = json.loads(resp.read())
    print(json.dumps(data, indent=2))
except urllib.error.HTTPError as e:
    error_body = e.read().decode()
    print(f"Error {e.code}: {error_body}")
