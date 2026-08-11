# Module: jobs.py

**Router file:** `backend/routers/jobs.py`  
**Registered in:** `main.py` → `app.include_router(jobs.router, prefix="/api")`  
**Used by:** `ConfigSummary.jsx` (Run Job 10 / Run Job 20 buttons, job status polling)

---

## Purpose

Triggers and monitors the two core medallion pipeline Databricks Jobs:

| Databricks job | Direction | Constant |
|---|---|---|
| `job_10_raw_to_bronze` | Raw files → Bronze Delta table | `DB_JOB_NAME` |
| `job_20_bronze_to_silver` | Bronze → Silver (merge/validation) | `DB_JOB_NAME_20` |

Before triggering Job 10, the endpoint updates `tbl_config` to mark only the selected entity as `active = TRUE` (all others are set to `FALSE`).

---

## Endpoints

### `POST /api/run-job` (Raw → Bronze)

Activates the selected config row, looks up `job_10_raw_to_bronze` by name in the Databricks workspace, and triggers a run.

**Request:**
```json
{
  "job_name_config": "pip_myfile",
  "domain":          "sg",
  "frequency":       "daily"
}
```

**Steps:**
1. `UPDATE tbl_config SET active = FALSE` (deactivate all)
2. `UPDATE tbl_config SET active = TRUE WHERE job_name = '<job_name_config>'`
3. `GET /api/2.1/jobs/list?name=job_10_raw_to_bronze` → get `job_id`
4. `POST /api/2.1/jobs/run-now` with `job_parameters: {domain, frequency}` → get `run_id`

**Response:**
```json
{ "status": "triggered", "run_id": 12345, "job_id": 67, "job_name": "job_10_raw_to_bronze" }
```

---

### `POST /api/run-bronze-to-silver` (Bronze → Silver)

Same flow as above but targets `job_20_bronze_to_silver` and does **not** modify `tbl_config` active flags.

**Request:**
```json
{ "domain": "sg", "frequency": "daily" }
```

---

### `GET /api/job-run-status/{run_id}`

Polls `GET /api/2.1/jobs/runs/get?run_id={run_id}` and returns a normalised status object.

**Response:**
```json
{
  "run_id": 12345,
  "life_cycle_state":  "RUNNING",
  "result_state":      "",
  "state_message":     "",
  "run_page_url":      "https://.../runs/12345",
  "start_time":        1700000000000,
  "end_time":          null,
  "tasks": [
    {
      "task_key":         "ingest",
      "life_cycle_state": "TERMINATED",
      "result_state":     "SUCCESS",
      "state_message":    "",
      "start_time":       1700000000000,
      "end_time":         1700000060000,
      "run_page_url":     "..."
    }
  ]
}
```

`life_cycle_state` values: `PENDING`, `RUNNING`, `TERMINATING`, `TERMINATED`, `SKIPPED`, `INTERNAL_ERROR`  
`result_state` values (terminal only): `SUCCESS`, `FAILED`, `TIMEDOUT`, `CANCELED`

---

### `GET /api/job-run-logs?layer=TIER%201`

Queries `tbl_job_run_log` for the most recent run of a given layer and returns failed tasks + QC failures.

**Query param `layer`:** must be `"TIER 1"` or `"TIER 2"` (validated).

**Response:**
```json
{
  "found": true,
  "job_run_id": "20260101_1234_pip_myfile",
  "task_errors": [
    { "task_name": "validate", "status": "FAILED", "error_message": "..." }
  ],
  "qc_failures": [
    { "qc_result": "FAILED", "failure_message": "NULL found in mandatory column" }
  ]
}
```

Returns `{"found": false, ...}` if no run record exists for that layer.

---

## Key internals

### `_update_active_sync(job_name_config)`
Runs two SQL statements in sequence:
```sql
UPDATE catalog_central.medallion_config.tbl_config SET active = FALSE;
UPDATE catalog_central.medallion_config.tbl_config SET active = TRUE WHERE job_name = '<safe>';
```
This ensures exactly one config is active before each Job 10 run.

### `_check_logs_sync(layer)`
1. Fetches the latest `job_run_id` for the given layer from `tbl_job_run_log`
2. Fetches non-SUCCESS rows from `tbl_task_run_log` for that run
3. Fetches non-SUCCEEDED rows from `tbl_qc_result` for that batch

---

## Databricks objects

| Object | Role |
|---|---|
| `catalog_central.medallion_config.tbl_config` | Config table; `active` flag controls which entity Job 10 processes |
| `catalog_central.utilities.tbl_job_run_log` | Run-level audit log |
| `catalog_central.utilities.tbl_task_run_log` | Task-level audit log |
| `catalog_central.utilities.tbl_qc_result` | QC check results |
| `job_10_raw_to_bronze` | Databricks job (Raw → Bronze) |
| `job_20_bronze_to_silver` | Databricks job (Bronze → Silver) |

---

## Extension notes

- **Add a Job 30:** Create `DB_JOB_NAME_30`, add a `RunJob30Request` model, implement `_find_job_by_name_sync` (already exists) + a new endpoint, then add a card in `ConfigSummary.jsx`.
- **Trigger with notebook parameters:** Extend the `job_parameters` dict in `_trigger_job_sync`.
- **Poll interval:** The frontend controls polling frequency — the backend endpoints are stateless.
