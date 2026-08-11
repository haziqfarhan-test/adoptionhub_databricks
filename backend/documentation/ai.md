# Module: ai.py

**Router file:** `backend/routers/ai.py`  
**Registered in:** `main.py` → `app.include_router(ai.router, prefix="/api")`  
**Used by:** `MetadataPage.jsx` (Enrich Columns button), `DictionarySection.jsx` (Generate SQL button)

---

## Purpose

Provides two LLM-powered enrichment endpoints that call Databricks Model Serving (OpenAI-compatible chat format) via `requests`.  
All LLM calls are synchronous (`requests.post`) and must be wrapped in `asyncio.to_thread`.

---

## Endpoints

### `POST /api/enrich-columns`

Takes a list of column objects and returns them enriched with AI-generated metadata.

**Request:**
```json
{
  "columns": [
    {
      "name": "EmployeeID",
      "detected_type": "integer",
      "sample_values": ["10001", "10002"],
      "null_pct": 0.0
    }
  ]
}
```

**Response:** same array with `description`, `pii`, and `classification` filled in:
```json
[
  {
    "name": "EmployeeID",
    "description": "Unique numeric identifier for each employee.",
    "pii": "pii",
    "classification": "confidential",
    ...original fields preserved...
  }
]
```

**PII values:** `"none"` | `"pii"` | `"sensitive"`  
**Classification values:** `"public"` | `"internal"` | `"confidential"` | `"restricted"`

The LLM receives a summary line per column (`name`, `detected_type`, `sample_values[:3]`, `null_pct`) and is instructed to return a JSON array.  
If the model returns malformed JSON, the endpoint raises HTTP 500.  
Columns not mentioned in the LLM response keep their original values (safe fallback).

---

### `POST /api/generate-dict-logic`

Converts a free-text "technical logic" description from the NCSS Data Dictionary into a single-line Spark SQL expression.

**Request:**
```json
{
  "element_name":    "employment_status",
  "technical_logic": "Must be one of: ACTIVE, INACTIVE, TERMINATED",
  "description":     "Current employment status of the employee"
}
```

**Response:**
```json
{ "sql": "employment_status IN ('ACTIVE', 'INACTIVE', 'TERMINATED')" }
```

The generated SQL is intended to be placed inside `invalid_df = df.filter(f"NOT (<output>)")`, so it expresses the **valid** condition (not the invalid one).

**Skip set:** If `technical_logic` is empty or matches one of `{"Align with Data Format", "MASTER_CODE_LOOKUP", "Not required"}`, the endpoint immediately returns `{"sql": ""}` without calling the LLM.

---

## Key internals

### `_call_serving_sync(prompt, max_tokens) → str`
Calls Databricks Model Serving:
```
POST {DATABRICKS_HOST}/serving-endpoints/{DATABRICKS_SERVING_ENDPOINT}/invocations
Authorization: Bearer {DATABRICKS_TOKEN}
Body: { "messages": [{"role": "user", "content": prompt}], "max_tokens": N }
```
Returns the raw text content of the first choice.  
Raises `requests.HTTPError` on non-2xx status.

### `_strip_md_fences(text) → str`
Removes `` ```json `` / `` ``` `` fences from the LLM response before JSON parsing. The LLM sometimes wraps its JSON in markdown even when instructed not to.

---

## Environment variables required

| Variable | Used for |
|---|---|
| `DATABRICKS_HOST` | Base URL of the Databricks workspace |
| `DATABRICKS_TOKEN` | Bearer auth token |
| `DATABRICKS_SERVING_ENDPOINT` | Name of the Model Serving endpoint (not the full URL) |

---

## Extension notes

- **Change the model:** Update `DATABRICKS_SERVING_ENDPOINT` in `.env` — no code change needed.
- **Add a new enrichment field:** Add it to the LLM prompt instructions and merge it into the result dict in `enrich_columns`.
- **Add a new skip value for dict logic:** Append to the `SKIP_LOGIC_SET` constant.
- **Increase token budget:** Adjust the `max_tokens` argument in each `_call_serving_sync` call. `enrich_columns` uses 2000 (JSON array can be large); `generate_dict_logic` uses 500 (single line).
