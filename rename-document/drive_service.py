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
