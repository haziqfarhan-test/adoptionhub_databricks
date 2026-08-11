# Module: files.py

**Router file:** `backend/routers/files.py`  
**Registered in:** `main.py` → `app.include_router(files.router, prefix="/api")`  
**Used by:** `MetadataPage.jsx` (Dataset tab — file dropzone)

---

## Purpose

Accepts a raw file upload (CSV, Excel, or other) from the frontend, parses it **locally** using pandas/openpyxl (no Databricks call), and returns structured column metadata that the UI uses to populate the MetadataGrid.

This is a pure in-process operation — no Databricks connection required.

---

## Endpoint

### `POST /api/parse-file`

**Request:** `multipart/form-data` with a single `file` field.  
**Supported extensions:** `.csv`, `.xls`, `.xlsx`  
**Other extensions:** Returns an empty DataFrame with `is_other_type: true` — the user fills in metadata manually.  
**Row limit:** First 100 rows are sampled for type inference.

**Response schema:**
```json
{
  "columns": [
    {
      "name":           "Original Column Name",
      "safe_name":      "original_column_name",
      "detected_type":  "string | integer | float | boolean | timestamp",
      "nullable":       true,
      "null_pct":       12.5,
      "sample_values":  ["val1", "val2", "val3"],
      "is_primary_key": false,
      "data_type":      null,
      "description":    "",
      "pii":            "none",
      "classification": "internal"
    }
  ],
  "row_count": 100,
  "file_meta": {
    "safe_name":        "my_file",
    "source_filename":  "my_file",
    "source_type":      "csv",
    "source_delimiter": ",",
    "schema_mapping":   "col_a String, col_b Integer",
    "column_order":     "col_a, col_b",
    "is_other_type":    false
  }
}
```

---

## Key helpers

### `clean_filename(name: str) → str`
Strips file extension, replaces non-alphanumeric characters with underscores, removes date suffixes (`YYYYMMDD`, `DDMMYYYY`, `_YYYY`), collapses repeated underscores, lowercases. Used to auto-populate `job_name`.

### `normalize_column_name(col_name: str) → str`
Makes a raw Excel/CSV header safe as a Databricks column name:
1. Strip whitespace
2. Replace spaces, dashes, slashes → `_`
3. Remove apostrophes, parentheses, and other punctuation
4. Remove characters not in `[a-zA-Z0-9_]`
5. Collapse `__` → `_`, strip leading/trailing `_`
6. Prefix `col_` if the result starts with a digit
7. Returns `"unnamed"` if the result is empty

**Critical:** Does NOT call `.lower()` — case is preserved intentionally.

### `TYPE_MAP`
Maps pandas dtype strings to the simplified set used in the UI:

| pandas dtype | returned type |
|---|---|
| `int64` / `int32` | `integer` |
| `float64` / `float32` | `float` |
| `bool` | `boolean` |
| `object` | `string` |
| `datetime64[ns/us]` | `timestamp` |

---

## Extension notes

- To support additional file formats (Parquet, JSON), add a branch in `parse_file` that loads the file into a DataFrame, then uses the existing column-analysis loop.
- `sample_values` is capped at 3 values; increase the `head(3)` call to expose more.
- The `data_type` field is intentionally `null` on parse — it is filled in by the user or by the AI enrichment call (`POST /api/enrich-columns`).
