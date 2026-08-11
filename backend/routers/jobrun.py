import os
import asyncio
import requests
from fastapi import APIRouter, HTTPException, Depends
from auth import get_user_token, current_token, sql_token
from pydantic import BaseModel
from typing import List
from dotenv import load_dotenv

load_dotenv()
router = APIRouter()

TABLE_REF    = "catalog_central.medallion_config.tbl_config"
UTILS_REF    = "catalog_central.utilities"
DB_JOB_NAME  = "job_10_raw_to_bronze"
DB_JOB_NAME_20 = "job_20_bronze_to_silver"

ENTITY_COLS = [
    "job_name", "source_entity_name", "source_filename",
    "bronze_table_path", "silver_table_name", "silver_load_type",
    "active", "domain", "target_category",
]


# ─────────────────────────────────────────────
# Connection helpers
# ─────────────────────────────────────────────
def _get_db_config():
    host  = os.getenv("DATABRICKS_HOST", "").rstrip("/")
    token = sql_token()
    if not host or not token:
        raise HTTPException(500, "DATABRICKS_HOST / DATABRICKS_TOKEN missing from .env")
    return host, token


def _get_sql_conn():
    from databricks import sql as dbsql
    host      = os.getenv("DATABRICKS_HOST", "").replace("https://", "").replace("http://", "").rstrip("/")
    http_path = os.getenv("DATABRICKS_HTTP_PATH", "")
    token     = sql_token()
    if not all([host, http_path, token]):
        raise HTTPException(500, "Databricks env vars missing from .env")
    return dbsql.connect(server_hostname=host, http_path=http_path, access_token=token)


def _row_to_dict(description, row) -> dict:
    cols = [d[0] for d in (description or [])]
    result = {}
    for k, v in zip(cols, row):
        if hasattr(v, "isoformat"):
            result[k] = v.isoformat()
        elif v is None:
            result[k] = None
        elif isinstance(v, (int, float, bool)):
            result[k] = v
        else:
            result[k] = str(v)
    return result


# ─────────────────────────────────────────────
# Models
# ─────────────────────────────────────────────
class RunEntitiesRequest(BaseModel):
    selected_job_names: List[str]
    domain: str
    frequency: str


class RunJob20Request(BaseModel):
    domain: str
    frequency: str


# ─────────────────────────────────────────────
# Sync helpers (all run via asyncio.to_thread)
# ─────────────────────────────────────────────
def _list_entities_sync() -> list:
    conn   = _get_sql_conn()
    cursor = conn.cursor()
    cols_sql = ", ".join(ENTITY_COLS)
    try:
        cursor.execute(f"SELECT {cols_sql} FROM {TABLE_REF} ORDER BY source_entity_name")
        return [_row_to_dict(cursor.description, r) for r in cursor.fetchall()]
    finally:
        cursor.close()
        conn.close()


def _set_active_sync(selected_job_names: List[str]):
    conn   = _get_sql_conn()
    cursor = conn.cursor()
    try:
        cursor.execute(f"UPDATE {TABLE_REF} SET active = FALSE")
        if selected_job_names:
            safe = ", ".join(
                f"'{n.replace(chr(39), chr(39)*2)}'" for n in selected_job_names
            )
            cursor.execute(f"UPDATE {TABLE_REF} SET active = TRUE WHERE job_name IN ({safe})")
    finally:
        cursor.close()
        conn.close()


def _find_job_id_sync(host: str, token: str, job_name: str = DB_JOB_NAME) -> int:
    resp = requests.get(
        f"{host}/api/2.1/jobs/list",
        headers={"Authorization": f"Bearer {token}"},
        params={"name": job_name},
    )
    if resp.status_code != 200:
        raise HTTPException(resp.status_code, f"Databricks jobs/list failed: {resp.text}")
    jobs = resp.json().get("jobs", [])
    if not jobs:
        raise HTTPException(404, f"Job '{job_name}' not found in Databricks workspace")
    return jobs[0]["job_id"]


def _trigger_job_sync(host: str, token: str, job_id: int, domain: str, frequency: str) -> int:
    resp = requests.post(
        f"{host}/api/2.1/jobs/run-now",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={
            "job_id": job_id,
            "job_parameters": {"domain": domain, "frequency": frequency},
        },
    )
    if resp.status_code != 200:
        raise HTTPException(resp.status_code, f"Failed to trigger job: {resp.text}")
    return resp.json()["run_id"]


def _fetch_run_logs_sync() -> dict:
    """
    Returns recent rows from tbl_job_run_log (latest 50) plus ALL
    tbl_task_run_log rows that share any of the most recent DISTINCT
    job_run_ids (up to 10).

    Using multiple job_run_ids is important because some pipeline notebooks
    write one tbl_job_run_log row PER ENTITY per run. As the job advances to
    the next entity a new job_run_id appears at the top; fetching only the
    single latest id would lose the previous entity's task rows.
    """
    conn   = _get_sql_conn()
    cursor = conn.cursor()
    try:
        cursor.execute(
            f"SELECT * FROM {UTILS_REF}.tbl_job_run_log ORDER BY start_time DESC LIMIT 50"
        )
        job_logs = [_row_to_dict(cursor.description, r) for r in cursor.fetchall()]

        task_logs = []
        if job_logs:
            # Collect up to 10 distinct recent job_run_ids
            seen: list = []
            seen_set: set = set()
            for row in job_logs[:10]:
                jid = row.get("job_run_id")
                if jid is not None and str(jid) not in seen_set:
                    seen.append(jid)
                    seen_set.add(str(jid))

            if seen:
                def _sql_id(jid):
                    try:
                        return str(int(jid))
                    except (ValueError, TypeError):
                        return f"'{str(jid).replace(chr(39), chr(39)*2)}'"

                ids_clause = ", ".join(_sql_id(j) for j in seen)
                cursor.execute(
                    f"SELECT * FROM {UTILS_REF}.tbl_task_run_log "
                    f"WHERE job_run_id IN ({ids_clause}) "
                    f"ORDER BY start_time"
                )
                task_logs = [_row_to_dict(cursor.description, r) for r in cursor.fetchall()]

        return {"job_logs": job_logs, "task_logs": task_logs}
    finally:
        cursor.close()
        conn.close()


# ─────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────
@router.get("/job-run/entities")
async def list_entities(_: str = Depends(get_user_token)):
    try:
        return await asyncio.to_thread(_list_entities_sync)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


@router.post("/job-run/run")
async def run_entities(req: RunEntitiesRequest, _: str = Depends(get_user_token)):
    if not req.selected_job_names:
        raise HTTPException(400, "No entities selected")
    host, token = _get_db_config()
    await asyncio.to_thread(_set_active_sync, req.selected_job_names)
    job_id = await asyncio.to_thread(_find_job_id_sync, host, token)
    run_id = await asyncio.to_thread(_trigger_job_sync, host, token, job_id, req.domain, req.frequency)
    return {
        "status":   "triggered",
        "run_id":   run_id,
        "job_id":   job_id,
        "job_name": DB_JOB_NAME,
    }


@router.post("/job-run/run-job20")
async def run_job20(req: RunJob20Request, _: str = Depends(get_user_token)):
    """Trigger job_20_bronze_to_silver with the given domain and frequency."""
    host, token = _get_db_config()
    job_id = await asyncio.to_thread(_find_job_id_sync, host, token, DB_JOB_NAME_20)
    run_id = await asyncio.to_thread(_trigger_job_sync, host, token, job_id, req.domain, req.frequency)
    return {
        "status":   "triggered",
        "run_id":   run_id,
        "job_id":   job_id,
        "job_name": DB_JOB_NAME_20,
    }


@router.get("/job-run/logs")
async def get_run_logs(_: str = Depends(get_user_token)):
    """Latest tbl_job_run_log rows + tbl_task_run_log rows for the most recent job_run_id."""
    try:
        return await asyncio.to_thread(_fetch_run_logs_sync)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))
