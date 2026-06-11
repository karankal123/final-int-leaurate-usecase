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
