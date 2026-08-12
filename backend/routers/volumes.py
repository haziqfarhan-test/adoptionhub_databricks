import os
import base64
import asyncio
import requests
from fastapi import APIRouter, HTTPException, Depends
from auth import get_user_token, service_principal_token
from pydantic import BaseModel

router = APIRouter()

class UploadFileRequest(BaseModel):
    filename: str
    content_b64: str
    volume_path: str


def _get_db_config():
    host = os.getenv("DATABRICKS_HOST", "").rstrip("/")
    if not host:
        raise HTTPException(500, "DATABRICKS_HOST missing from environment")
    return host, service_principal_token()


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
