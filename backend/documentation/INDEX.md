# Backend Module Documentation — AdoptionHub

Each file in this folder documents one FastAPI router registered in `main.py`.  
All routers are mounted under the `/api` prefix.

| File | Router | Prefix | Purpose |
|---|---|---|---|
| [files.md](files.md) | `routers/files.py` | `/api` | Local file parsing (CSV/Excel → column metadata) |
| [config.md](config.md) | `routers/config.py` | `/api` | Pipeline config CRUD against Databricks `tbl_config` |
| [ai.md](ai.md) | `routers/ai.py` | `/api` | LLM-powered column enrichment and SQL logic generation |
| [volumes.md](volumes.md) | `routers/volumes.py` | `/api` | Source file upload to Databricks Volumes via Files API |
| [jobs.md](jobs.md) | `routers/jobs.py` | `/api` | Trigger Raw→Bronze and Bronze→Silver pipeline jobs |
| [dictionary.md](dictionary.md) | `routers/dictionary.py` | `/api` | NCSS Data Dictionary Excel parse and upload |
| [jobrun.md](jobrun.md) | `routers/jobrun.py` | `/api` | Job Run module — entity selector, job trigger, log polling |
| [genie.md](genie.md) | `routers/genie.py` | `/api` | Marketplace (AI Genie) — natural-language to live dashboard |

## Global rules that every router must follow

1. **`asyncio.to_thread` for ALL blocking I/O** — `databricks-sql-connector` and `requests` are synchronous. Never call them directly from an `async` route handler.
2. **SQL sanitization** — Databricks connector does not support parameterized queries. Use `sql_literal()` (config.py) or `_esc()` (genie.py). Never write a raw f-string with user data into SQL.
3. **Sync helper naming** — blocking helpers are prefixed `_` and named `_<verb>_sync` (e.g. `_save_sync`, `_fetch_run_logs_sync`).
4. **Case preservation** — `normalize_column_name()` and `normalize_element_name()` do **not** call `.lower()`. Case is preserved intentionally.

## Environment variables (backend/.env)

```
DATABRICKS_HOST=https://<workspace>.azuredatabricks.net
DATABRICKS_TOKEN=dapi...
DATABRICKS_HTTP_PATH=/sql/1.0/warehouses/<id>
DATABRICKS_SERVING_ENDPOINT=<model-serving-endpoint-name>
```
