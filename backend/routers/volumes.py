import os
import base64
import asyncio
import requests
from fastapi import APIRouter, HTTPException, Depends
from auth import get_user_token
from pydantic import BaseModel

router = APIRouter()

class UploadFileRequest(BaseModel):
    filename: str
    content_b64: str
    volume_path: str


def _get_service_principal_token() -> str:
    token = os.getenv("DATABRICKS_TOKEN", "")
    if token:
        return token

    host = os.getenv("DATABRICKS_HOST", "").rstrip("/")
    client_id = os.getenv("DATABRICKS_CLIENT_ID", "")
    client_secret = os.getenv("DATABRICKS_CLIENT_SECRET", "")

    missing = [name for name, value in [
        ("DATABRICKS_HOST", host),
        ("DATABRICKS_CLIENT_ID", client_id),
        ("DATABRICKS_CLIENT_SECRET", client_secret),
    ] if not value]
    if missing:
        raise HTTPException(
            500,
            f"No service principal token available. Missing env vars: {', '.join(missing)}."
        )

    resp = requests.post(
        f"{host}/oidc/v1/token",
        data={
            "grant_type": "client_credentials",
            "client_id": client_id,
            "client_secret": client_secret,
            "scope": "all-apis",
        },
        timeout=10,
    )
    if not resp.ok:
        raise HTTPException(
            500,
            f"Service principal token request failed ({resp.status_code}): {resp.text}"
        )

    access_token = resp.json().get("access_token", "")
    if not access_token:
        raise HTTPException(
            500,
            "Service principal token request succeeded but returned no access_token."
        )
    return access_token


def _get_db_config():
    host  = os.getenv("DATABRICKS_HOST", "").rstrip("/")
    token = _get_service_principal_token()
    if not host:
        raise HTTPException(500, "DATABRICKS_HOST missing from environment")
    return host, token


def _upload_sync(host: str, token: str, volume_path: str, filename: str, content: bytes):
    full_path = volume_path.rstrip("/") + "/" + filename
    url = f"{host}/api/2.0/fs/files{full_path}"
    resp = requests.put(
        url,
        headers={"Authorization": f"Bearer {token}"},
        params={"overwrite": "true"},
        data=content,
    )
    if resp.status_code not in (200, 201, 204):
        raise HTTPException(
            status_code=resp.status_code,
            detail=f"Databricks upload failed ({resp.status_code}): {resp.text}",
        )
    return full_path


@router.post("/upload-to-volume")
async def upload_to_volume(req: UploadFileRequest, _: str = Depends(get_user_token)):
    host, token = _get_db_config()
    content  = base64.b64decode(req.content_b64)
    filename = req.filename or "upload"
    try:
        full_path = await asyncio.to_thread(
            _upload_sync, host, token, req.volume_path, filename, content
        )
        return {"status": "uploaded", "path": full_path, "filename": filename}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
