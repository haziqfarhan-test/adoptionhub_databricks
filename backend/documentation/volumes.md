# Module: volumes.py

**Router file:** `backend/routers/volumes.py`  
**Registered in:** `main.py` → `app.include_router(volumes.router, prefix="/api")`  
**Used by:** `ConfigSummary.jsx` (Upload to Volume step — Phase 1 of pipeline)

---

## Purpose

Uploads a source data file directly from the browser to a Databricks Volume using the Databricks Files API (`PUT /api/2.0/fs/files`).  
No Databricks SQL connection is used — this is a REST call only.

---

## Endpoint

### `POST /api/upload-to-volume`

**Request:** `multipart/form-data`

| Field | Type | Description |
|---|---|---|
| `file` | `UploadFile` | The binary file to upload |
| `volume_path` | `str` (form field) | Full Volume path, e.g. `/Volumes/catalog_sg/raw/file_upload/` |

**Example `volume_path` values:**
```
/Volumes/catalog_sg/raw/file_upload/
/Volumes/catalog_pg/raw/file_upload/
```

**Response:**
```json
{
  "status": "uploaded",
  "path": "/Volumes/catalog_sg/raw/file_upload/myfile.csv",
  "filename": "myfile.csv"
}
```

The `overwrite=true` query parameter is always sent so re-uploads replace the existing file.

---

## Key internals

### `_upload_sync(host, token, volume_path, filename, content)`
Constructs the Files API URL:
```
PUT {DATABRICKS_HOST}/api/2.0/fs/files{volume_path}/{filename}?overwrite=true
Authorization: Bearer {DATABRICKS_TOKEN}
Body: raw file bytes
```

Accepts HTTP 200, 201, or 204 as success. Any other status raises an `HTTPException` with the Databricks error body.

---

## Databricks object

| Object | Role |
|---|---|
| `/Volumes/catalog_<domain>/raw/file_upload/` | Landing zone for raw source files before Raw→Bronze job |

---

## Environment variables required

| Variable | Used for |
|---|---|
| `DATABRICKS_HOST` | Base URL of the Databricks workspace |
| `DATABRICKS_TOKEN` | Bearer auth token |

---

## Extension notes

- **Upload to a different volume:** Pass a different `volume_path` form value — the endpoint is path-agnostic.
- **Large files:** The entire file is read into memory (`await file.read()`). For very large files, consider streaming using `requests` `data` parameter with a generator, but this requires changes to `_upload_sync`.
- **Validate file type server-side:** Check `file.filename` extension before uploading if you want to restrict accepted formats.
