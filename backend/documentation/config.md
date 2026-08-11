# Module: config.py

**Router file:** `backend/routers/config.py`  
**Registered in:** `main.py` → `app.include_router(config.router, prefix="/api")`  
**Used by:** `MetadataPage.jsx` → `ConfigSummary.jsx` (save button), `MetadataGrid.jsx` (column editor)

---

## Purpose

Manages pipeline configuration rows in the Databricks Delta table `catalog_central.medallion_config.tbl_config`.  
Each row in `tbl_config` represents one source entity (one CSV/Excel file) in the medallion pipeline.  
The endpoint uses a SQL `MERGE` (upsert) so re-saving an existing `job_name` updates rather than duplicates.

---

## Endpoints

### `POST /api/save-config`

Upserts a full pipeline config row into `tbl_config`.  
Derives all Bronze and Silver path/schema fields from the submitted `TableConfig` payload and the column list.

**Request body** (`TableConfig`):
```json
{
  "job_name":            "pip_myfile",
  "source_system":       "NCSS",
  "target_category":     "daily",
  "active":              true,
  "load_sequence":       1,
  "owner":               "NCSS",
  "domain":              "sg",
  "pipeline_name":       "pipeline_01_raw_to_bronze",
  "source_entity_name":  "myfile",
  "source_type":         "csv",
  "source_filename":     "myfile",
  "source_path":         "/Volumes/catalog_sg/raw/file_upload/",
  "source_delimiter":    ",",
  "bronze_catalog_name": "catalog_sg",
  "bronze_table_name":   "bronze_myfile",
  "bronze_archive_path": "/Volumes/...",
  "silver_catalog_name": "catalog_sg",
  "silver_table_name":   "silver_myfile",
  "silver_curated_path": "...",
  "silver_history_path": "...",
  "silver_invalid_path": "...",
  "silver_load_type":    "full",
  "columns": [ ... ]
}
```

**Derived fields (not in request, computed server-side):**

| Field | Derivation |
|---|---|
| `bronze_table_path` | `{bronze_catalog_name}.bronze.{bronze_table_name}` |
| `bronze_column_order` | comma-joined `safe_name` of all columns |
| `bronze_schema_mapping` | `col_name Type, ...` e.g. `employee_id Integer, name String` |
| `bronze_write_mode` | hardcoded `"overwrite"` |
| `bronze_load_type` | hardcoded `"full"` |
| `silver_schema_name` | hardcoded `"silver"` |
| `silver_column_order` | same as bronze |
| `silver_schema_mapping` | same as bronze |
| `silver_primary_key` | comma-joined `safe_name` of columns where `is_primary_key=true` |
| `silver_merge_keys` | same as `silver_primary_key` |
| `silver_mandatory_columns` | comma-joined `safe_name` of non-nullable columns |
| `source_filename` | date suffix stripped via `remove_date_suffix()` |

**Response:** the full saved row dict plus `{"status": "saved", "job_name": "..."}`.

---

### `POST /api/validate-columns`

Validates a list of `ColumnConfig` objects before save.  
Checks each `safe_name` against:
- Empty string
- Starting with a digit
- Exceeding 255 characters
- Containing characters outside `[a-zA-Z0-9_]`
- Matching a Databricks SQL reserved keyword (set of ~60 words)

**Response:**
```json
{
  "valid": false,
  "errors": [
    { "column": "Original Name", "safe_name": "select", "reason": "'select' is a reserved Databricks keyword" }
  ]
}
```

---

### `GET /api/configs`

Returns all rows from `tbl_config` ordered by `job_name`.  
Used by the UI to show the existing config list and by `ConfigSummary` to check current pipeline state.

---

## Key helpers

### `sql_literal(key, val) → str`
Safe SQL value serialiser — prevents injection since Databricks SQL connector does not support parameterized queries.

| Column type | Output |
|---|---|
| `None` | `NULL` |
| boolean columns (`active`, `*_active_status`) | `TRUE` / `FALSE` |
| integer columns (`load_sequence`) | bare integer string |
| everything else | `'escaped string'` (single quotes doubled) |

### `normalize_column_name(col_name)`
Same logic as `files.py` — strips/replaces unsafe characters, preserves case, no `.lower()`.

### `remove_date_suffix(name)`
Strips trailing date patterns (`_20230101`, `-2023-01-01`, `_2023`) from `source_filename` to avoid including run-date stamps in the stored config key.

---

## Databricks object

| Object | Role |
|---|---|
| `catalog_central.medallion_config.tbl_config` | Primary config store; PK is `job_name` |

---

## Extension notes

- **Add a new config field:** Add it to `MERGE_COLS`, add a corresponding Pydantic field to `TableConfig`, compute it in the `row` dict inside `save_config`, and reference it in the UI.
- **Add a new reserved keyword:** Append to the `DATABRICKS_RESERVED` set in `config.py`.
- **Bulk import:** `save_config` accepts one row at a time. For bulk, call it in a loop or add a new endpoint that iterates over a list and calls `_save_sync`.
