# Module: dictionary.py

**Router file:** `backend/routers/dictionary.py`  
**Registered in:** `main.py` → `app.include_router(dictionary.router, prefix="/api")`  
**Used by:** `MetadataPage.jsx` → `DictionarySection.jsx` (Data Dictionary tab)

---

## Purpose

Handles the NCSS Data Dictionary Excel workbook lifecycle:
1. **Parse** — read an uploaded `.xlsx` into two structured sections (Data Dictionary + Master Code)
2. **Enrich** — (client-side) AI generates SQL logic per element (`POST /api/generate-dict-logic`)
3. **Upload** — rebuild the Excel workbook with enriched data and push to a Databricks Volume

The NCSS Data Dictionary has a fixed 4-sheet layout. This module understands that layout and correctly round-trips data through parse → edit → upload.

---

## Endpoints

### `POST /api/parse-dictionary`

**Request:** `multipart/form-data`, field `file`, expects `.xlsx`.

Reads four specific sheets:

| Sheet name | Section | Purpose |
|---|---|---|
| `System Level` | Data Dictionary | System-wide element definitions |
| `Domain Level - All` | Data Dictionary | Domain-specific element definitions |
| `System - Code Table` | Master Code | System-level code lookups |
| `Domain - Code Table` | Master Code | Domain-level code lookups |

Both `System Level` + `Domain Level - All` are merged into a single row list (`data_dictionary.rows`).  
Both code sheets are merged into `master_code.rows`.  
Empty rows are skipped.

**Response:**
```json
{
  "data_dictionary": {
    "headers": ["Data Element Name", "Dictionary Level", "Technical Logic", ...],
    "rows": [
      {
        "Data Element Name": "EmployeeID",
        "Dictionary Level": "SYSTEM",
        "_safe_element_name": "EmployeeID",
        "_generated_sql": "",
        ...
      }
    ]
  },
  "master_code": {
    "headers": ["Code", "Description", "Code Level", ...],
    "rows": [ ... ]
  }
}
```

Two synthetic fields are injected into each Data Dictionary row:
- `_safe_element_name` — `normalize_element_name(Data Element Name)` — database-safe column name
- `_generated_sql` — starts empty; filled by the frontend after calling `/api/generate-dict-logic`

---

### `POST /api/upload-dictionary`

Reconstructs the Excel workbook from the (possibly enriched) row data and uploads it to the Databricks Volume at `/Volumes/catalog_central/dictionary/file_upload/`.

**Request body:**
```json
{
  "data_dictionary": { "headers": [...], "rows": [...] },
  "master_code":     { "headers": [...], "rows": [...] },
  "filename":        "NCSS_Data_Dictionary.xlsx"
}
```

**Write logic:**
- DD rows where `Dictionary Level == "SYSTEM"` → `System Level` sheet
- DD rows where `Dictionary Level != "SYSTEM"` → `Domain Level - All` sheet
- MC rows where `Code Level == "System"` → `System - Code Table` sheet
- MC rows where `Code Level != "System"` → `Domain - Code Table` sheet
- Internal fields (`_safe_element_name`, `_generated_sql`) are **not** written to the Excel file — they are stripped by filtering headers that start with `_`
- The `Data Element Name` column writes `_safe_element_name` (normalised value)
- The `Dictionary Technical Logic` column writes `_generated_sql` if non-empty, else the original value

**Response:**
```json
{ "status": "uploaded", "path": "/Volumes/catalog_central/dictionary/file_upload/NCSS_Data_Dictionary.xlsx" }
```

---

## Key helpers

### `normalize_element_name(name) → str`
Same normalisation logic as `files.py`'s `normalize_column_name` — strips unsafe characters, preserves case (no `.lower()`). Used for `Data Element Name` → `_safe_element_name`.

### `_parse_sheet(ws) → (headers, rows)`
Reads a worksheet: takes headers from row 1, creates one dict per data row, skips all-blank rows, strips `\xa0` non-breaking spaces and `"None"` strings.

### `_merge_sheets(wb, sheet_names) → (headers, rows)`
Iterates multiple sheet names, parsing each and concatenating their rows. Returns the headers from the first matching sheet found.

### `_cell_value(row, h) → str`
Resolver for a single cell during write-back:
- Header `Data Element Name` → returns `row["_safe_element_name"]`
- Header `Dictionary Technical Logic` → returns `_generated_sql` if non-empty, else original
- All other headers → returns raw value

---

## Databricks object

| Object | Role |
|---|---|
| `/Volumes/catalog_central/dictionary/file_upload/` | Volume where the enriched dictionary Excel is stored |

---

## Extension notes

- **Add a fifth sheet:** Add the sheet name to `DICT_SHEETS` or `CODE_SHEETS`, and handle its rows in `_build_and_upload_sync` using a new discriminator column.
- **Change the upload volume path:** Update `DICT_VOLUME_PATH` constant.
- **Preserve formatting:** `openpyxl` in default mode does not preserve existing cell styles; if formatting matters, consider `keep_vba=True` or copying source styles.
