import os
import asyncio
import requests
from fastapi import APIRouter, HTTPException, Depends
from auth import get_user_token, current_token, sql_token
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()
router = APIRouter()

TABLE_REF    = "catalog_central.medallion_config.tbl_config"
DB_JOB_NAME  = "job_10_raw_to_bronze"
DB_JOB_NAME_20 = "job_20_bronze_to_silver"
UTILS_REF    = "catalog_central.utilities"


def _get_db_config():
    host  = os.getenv("DATABRICKS_HOST", "").rstrip("/")
    token = current_token()
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


# ─────────────────────────────────────────────
# Models
# ─────────────────────────────────────────────
class RunJobRequest(BaseModel):
    job_name_config: str   # job_name value in the config table (e.g. pip_myfile)
    domain: str
    frequency: str         # target_category value (daily / weekly / monthly / yearly)


# ─────────────────────────────────────────────
# Sync helpers (run in thread pool)
# ─────────────────────────────────────────────
def _update_active_sync(job_name_config: str):
    conn   = _get_sql_conn()
    cursor = conn.cursor()
    safe   = job_name_config.replace("'", "''")
    try:
        cursor.execute(f"UPDATE {TABLE_REF} SET active = FALSE")
        cursor.execute(f"UPDATE {TABLE_REF} SET active = TRUE WHERE job_name = '{safe}'")
    finally:
        cursor.close()
        conn.close()


def _find_job_id_sync(host: str, token: str) -> int:
    resp = requests.get(
        f"{host}/api/2.1/jobs/list",
        headers={"Authorization": f"Bearer {token}"},
        params={"name": DB_JOB_NAME},
    )
    if resp.status_code != 200:
        raise HTTPException(resp.status_code, f"Databricks jobs/list failed: {resp.text}")
    jobs = resp.json().get("jobs", [])
    if not jobs:
        raise HTTPException(404, f"Job '{DB_JOB_NAME}' not found in Databricks workspace")
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


def _find_job_by_name_sync(host: str, token: str, job_name: str) -> int:
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


def _check_logs_sync(layer: str) -> dict:
    conn   = _get_sql_conn()
    cursor = conn.cursor()
    safe_layer = layer.replace("'", "''")
    try:
        cursor.execute(
            f"SELECT job_run_id FROM {UTILS_REF}.tbl_job_run_log "
            f"WHERE layer = '{safe_layer}' ORDER BY start_time DESC LIMIT 1"
        )
        row = cursor.fetchone()
        if not row:
            return {"found": False, "job_run_id": None, "task_errors": [], "qc_failures": []}
        job_run_id = row[0]

        # Safely format the ID for subsequent queries
        if isinstance(job_run_id, (int, float)):
            jid_sql = str(int(job_run_id))
        else:
            jid_sql = f"'{str(job_run_id).replace(chr(39), chr(39)*2)}'"

        cursor.execute(
            f"SELECT * FROM {UTILS_REF}.tbl_task_run_log "
            f"WHERE job_run_id = {jid_sql} "
            f"AND (error_message IS NOT NULL OR status != 'SUCCESS')"
        )
        task_cols   = [d[0] for d in (cursor.description or [])]
        task_errors = [
            {k: (str(v) if v is not None else None) for k, v in zip(task_cols, r)}
            for r in cursor.fetchall()
        ]

        cursor.execute(
            f"SELECT * FROM {UTILS_REF}.tbl_qc_result "
            f"WHERE batch_job_id = {jid_sql} "
            f"AND qc_result != 'SUCCEEDED'"
        )
        qc_cols    = [d[0] for d in (cursor.description or [])]
        qc_failures = [
            {k: (str(v) if v is not None else None) for k, v in zip(qc_cols, r)}
            for r in cursor.fetchall()
        ]

        return {
            "found":       True,
            "job_run_id":  str(job_run_id),
            "task_errors": task_errors,
            "qc_failures": qc_failures,
        }
    finally:
        cursor.close()
        conn.close()


def _get_run_status_sync(host: str, token: str, run_id: int) -> dict:
    resp = requests.get(
        f"{host}/api/2.1/jobs/runs/get",
        headers={"Authorization": f"Bearer {token}"},
        params={"run_id": run_id},
    )
    if resp.status_code != 200:
        raise HTTPException(resp.status_code, f"Failed to get run status: {resp.text}")
    data  = resp.json()
    state = data.get("state", {})

    tasks = []
    for t in data.get("tasks", []):
        ts = t.get("state", {})
        tasks.append({
            "task_key":          t.get("task_key", ""),
            "description":       t.get("description", ""),
            "life_cycle_state":  ts.get("life_cycle_state", "PENDING"),
            "result_state":      ts.get("result_state", ""),
            "state_message":     ts.get("state_message", ""),
            "start_time":        t.get("start_time"),
            "end_time":          t.get("end_time"),
            "run_page_url":      t.get("run_page_url", ""),
        })

    return {
        "run_id":            run_id,
        "life_cycle_state":  state.get("life_cycle_state", "UNKNOWN"),
        "result_state":      state.get("result_state", ""),
        "state_message":     state.get("state_message", ""),
        "run_page_url":      data.get("run_page_url", ""),
        "start_time":        data.get("start_time"),
        "end_time":          data.get("end_time"),
        "tasks":             tasks,
    }


# ─────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────
@router.post("/run-job")
async def run_job(req: RunJobRequest, _: str = Depends(get_user_token)):
    host, token = _get_db_config()

    # 1. Update active flags in config table
    await asyncio.to_thread(_update_active_sync, req.job_name_config)

    # 2. Find Databricks job ID
    job_id = await asyncio.to_thread(_find_job_id_sync, host, token)

    # 3. Trigger the run
    run_id = await asyncio.to_thread(_trigger_job_sync, host, token, job_id, req.domain, req.frequency)

    return {"status": "triggered", "run_id": run_id, "job_id": job_id, "job_name": DB_JOB_NAME}


@router.get("/job-run-status/{run_id}")
async def get_job_run_status(run_id: int, _: str = Depends(get_user_token)):
    host, token = _get_db_config()
    try:
        return await asyncio.to_thread(_get_run_status_sync, host, token, run_id)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/job-run-logs")
async def get_job_run_logs(layer: str, _: str = Depends(get_user_token)):
    if layer not in ("TIER 1", "TIER 2"):
        raise HTTPException(400, "layer must be 'TIER 1' or 'TIER 2'")
    try:
        return await asyncio.to_thread(_check_logs_sync, layer)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class RunJob20Request(BaseModel):
    domain: str
    frequency: str


@router.post("/run-bronze-to-silver")
async def run_bronze_to_silver(req: RunJob20Request, _: str = Depends(get_user_token)):
    host, token = _get_db_config()
    job_id = await asyncio.to_thread(_find_job_by_name_sync, host, token, DB_JOB_NAME_20)
    run_id = await asyncio.to_thread(_trigger_job_sync, host, token, job_id, req.domain, req.frequency)
    return {"status": "triggered", "run_id": run_id, "job_id": job_id, "job_name": DB_JOB_NAME_20}
