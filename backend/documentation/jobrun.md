# Module: jobrun.py

**Router file:** `backend/routers/jobrun.py`  
**Registered in:** `main.py` → `app.include_router(jobrun.router, prefix="/api")`  
**Used by:** `JobRunPage.jsx`

---

## Purpose

Powers the **Job Run** module — a dedicated UI for data engineers to:
1. Browse all pipeline entities from `tbl_config`
2. Select which entities to activate
3. Trigger `job_10_raw_to_bronze` for the selected entities
4. Monitor per-entity and per-task progress in real time via log polling

This module is distinct from `jobs.py` in that it exposes entity-level selection and multi-entity log fetching, while `jobs.py` is used by `ConfigSummary` for single-entity runs during the metadata configuration workflow.

---

## Endpoints

### `GET /api/job-run/entities`

Returns all rows from `tbl_config` with the columns defined in `ENTITY_COLS`:

```python
ENTITY_COLS = [
    "job_name", "source_entity_name", "source_filename",
    "bronze_table_path", "silver_table_name", "silver_load_type",
    "active", "domain", "target_category",
]
```

Used to populate the entity selector table in the UI.

**Response:** array of row dicts, ordered by `source_entity_name`.

---

### `POST /api/job-run/run`

Activates selected entities, looks up the Databricks job by name, and triggers a run.

**Request:**
```json
{
  "selected_job_names": ["pip_entity_a", "pip_entity_b"],
  "domain":             "sg",
  "frequency":          "daily"
}
```

**Steps:**
1. `UPDATE tbl_config SET active = FALSE` (all entities)
2. `UPDATE tbl_config SET active = TRUE WHERE job_name IN ('pip_entity_a', 'pip_entity_b')`
3. Lookup `job_10_raw_to_bronze` → get `job_id`
4. Trigger run → get `run_id`

**Response:**
```json
{ "status": "triggered", "run_id": 12345, "job_id": 67, "job_name": "job_10_raw_to_bronze" }
```

---

### `GET /api/job-run/logs`

Returns the latest job-level and task-level log rows for in-progress monitoring.

**Key design — multi-`job_run_id` fetch:**  
Each entity in a pipeline run gets its own `job_run_id` (format `YYYYMMDD_XXXX_pip_<job_name>`). As the Databricks job advances through entities, new `job_run_id`s appear in `tbl_job_run_log`. Fetching only the single latest `job_run_id` would lose earlier entities' task rows.

The `_fetch_run_logs_sync` helper fetches up to **10 distinct recent `job_run_id`s** from the latest 50 job log rows, then fetches ALL `tbl_task_run_log` rows that match any of those IDs.

**Response:**
```json
{
  "job_logs": [
    {
      "job_run_id":  "20260522_6707_pip_synthetic_data_ncss_entity",
      "layer":       "TIER 1",
      "start_time":  "2026-05-22T08:00:00",
      ...
    }
  ],
  "task_logs": [
    {
      "job_run_id":    "20260522_6707_pip_synthetic_data_ncss_entity",
      "task_name":     "ingest",
      "status":        "SUCCESS",
      "start_time":    "2026-05-22T08:00:01",
      "end_time":      "2026-05-22T08:00:45",
      "error_message": null
    }
  ]
}
```

---

## `job_run_id` format

```
YYYYMMDD_XXXX_pip_<job_name>
e.g. 20260522_6707_pip_synthetic_data_ncss_entity
```

The entity's `job_name` value is embedded at the end after `pip_`. The frontend uses `job_run_id.includes(job_name)` to match task logs to the entity they belong to.

---

## Critical patterns (frontend contract)

These rules are documented here because violations silently corrupt the UI state:

| # | Rule |
|---|---|
| 1 | **Upsert task logs by `task_name\|job_run_id`** — the frontend accumulates logs across polls and must overwrite existing rows (not append) so `STARTED` rows update to `SUCCESS`/`FAILED`. |
| 2 | **UTC timestamps without trailing Z** — `tbl_task_run_log` and `tbl_job_run_log` store UTC without `Z`. The frontend appends `Z` before parsing (`toUtcDate(iso)`). |
| 3 | **All entities amber while job runs** — `entityStatus()` returns `'inprogress'` for ALL entities when `isJobRunning=true`, regardless of log presence. Green/red is only applied after the job reaches terminal state. |

---

## Databricks objects

| Object | Role |
|---|---|
| `catalog_central.medallion_config.tbl_config` | Entity registry; `active` flag selects entities for the run |
| `catalog_central.utilities.tbl_job_run_log` | Job-level audit; contains `layer`, `job_run_id`, `start_time` |
| `catalog_central.utilities.tbl_task_run_log` | Task-level audit; contains `task_name`, `status`, `error_message`, timestamps |
| `job_10_raw_to_bronze` | Databricks job triggered by this module |

---

## Extension notes

- **Add entity columns to the UI table:** Add the column name to `ENTITY_COLS` in `jobrun.py`, then add the corresponding header in `JobRunPage.jsx`'s `EntityTable`.
- **Add job 20 trigger support:** Implement a second `POST /api/job-run/run-silver` endpoint referencing `job_20_bronze_to_silver` (see `jobs.py` for the pattern).
- **Increase log history depth:** Change `LIMIT 50` in `_fetch_run_logs_sync` and adjust the `[:10]` distinct `job_run_id` slice.
