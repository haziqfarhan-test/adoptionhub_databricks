# Module: genie.py

**Router file:** `backend/routers/genie.py`  
**Registered in:** `main.py` → `app.include_router(genie.router, prefix="/api")`  
**Used by:** `GeniePage.jsx`  
**Whitelist config:** `backend/marketplace_whitelist.json` (shared with Marketplace module)

---

## Purpose

AI Genie is a natural-language-to-dashboard pipeline.  
A user types a plain-English question; the module returns a fully structured dashboard response including generated SQL, chart widgets, a dashboard title and description, key insights, and data lineage metadata.

Inspired by Databricks AI/BI Genie.

---

## Pipeline phases

```
Phase 1 — Schema grounding    Load whitelist + DESCRIBE TABLE from Databricks (TTL-cached 10 min)
Phase 2 — Text-to-SQL         LLM generates SELECT; self-correction loop retries on failure (≤3 times)
Phase 3 — Chart engine         Deterministic widget selection based on result shape (no LLM)
Phase 4 — Narrative + lineage  LLM generates title/description/summary/insights; SQL parsed for lineage
```

---

## Endpoints

### `POST /api/genie/ask`

Runs the full pipeline for a natural-language question.

**Request:** `{ "question": "How many employees are in each leadership stage?" }`

**Response:**
```json
{
  "dashboard_title":       "Employee Count by Leadership Stage",
  "dashboard_description": "This dashboard shows headcount distribution across leadership stages.",
  "speech_bubble_summary": "There are 5 leadership stages. Stage 3 has the highest count at 142 employees.",
  "key_insights":          ["Stage 3 leads with 142 employees.", "Stage 5 has the fewest at 18."],
  "lineage": {
    "tables_used":     ["catalog_sg.silver.tbl_sg_synthetic_data_for_sunray"],
    "result_columns":  ["leadership_stage", "employee_count"],
    "transformations": ["Aggregations: COUNT", "Grouped by: leadership_stage"],
    "row_count":       5,
    "has_joins":       false
  },
  "sql_used": "SELECT leadership_stage, COUNT(*) AS employee_count FROM ... GROUP BY 1 LIMIT 1000",
  "layout": {
    "widgets": [
      {
        "type":   "BAR_CHART",
        "title":  "Employee Count by Leadership Stage",
        "x_key":  "leadership_stage",
        "y_keys": ["employee_count"],
        "data":   [ ... ]
      },
      {
        "type":  "TABLE",
        "title": "Full Results",
        "data":  [ ... ]
      }
    ]
  }
}
```

---

### `GET /api/genie/schema`

Returns the whitelist tables enriched with live column metadata from Databricks.  
Results are TTL-cached — first call per table hits Databricks; subsequent calls within 10 min return cached data.

Used by the frontend's "Available tables" hint panel.

**Response:**
```json
[
  {
    "table":       "catalog_sg.silver.tbl_sg_synthetic_data_for_sunray",
    "description": "...",
    "domain":      "Services",
    "columns":     [
      { "name": "Sun_Ray_WorkdayIDNo", "type": "string" },
      { "name": "leadership_stage",    "type": "string" }
    ]
  }
]
```

---

## Phase 1 — Schema grounding

### `_get_all_schemas_sync() → list[dict]`
Loads `marketplace_whitelist.json` and calls `DESCRIBE TABLE` for each entry.  
Results are cached in `_schema_cache` dict keyed by `"catalog.schema.table"` with TTL of 600 seconds.  
Returns enriched entries: `{catalog, schema, table, description, domain, fq_name, columns: [{name, type}]}`.

### `_match_schemas(question, all_schemas) → list[dict]`
Keyword scoring against the question tokens:
- Table name tokens: +3 per match
- Column name tokens (excluding noise: `id`, `key`, `code`, `flag`, `type`): +2 per match
- Description tokens: +1 per match
- Domain tokens: +2 per match

Returns all tables with score > 0, or all tables if nothing scores.

### `_format_schema_context(schemas) → str`
Formats matched schemas as a text block for the LLM SQL prompt:
```
Table: catalog_sg.silver.tbl_sg_synthetic_data_for_sunray
Domain: Services
Purpose: Employee data...
Columns:
  - leadership_stage (string)
  - Sun_Ray_WorkdayIDNo (string)
```

---

## Phase 2 — Text-to-SQL with self-correction

### `_generate_sql_sync(question, schema_ctx) → str`
Prompts the LLM with schema context and question. Rules enforced in prompt:
1. Output ONLY SQL — no markdown, no explanation
2. SELECT statements only (no DML/DDL)
3. Use exact fully-qualified table names
4. Only reference columns listed in schema
5. Add `LIMIT 1000` if result could be large
6. Use Databricks SQL syntax (`date_trunc`, `INTERVAL`, `try_cast`, etc.)
7. Keep SELECT list minimal
8. Avoid complex derived columns
9. No aliases that shadow reserved words

`max_tokens=1500`

### `_fix_sql_sync(sql, error, schema_ctx) → str`
Sends the broken SQL + error message back for correction.  
If the error mentions "truncated" or "unbalanced", adds a "Write a much shorter, simpler query" hint.

`max_tokens=1500`

### `_check_balanced_parens(sql)`
Raises `ValueError` if parenthesis depth ≠ 0 after scanning the SQL (skipping string literals).  
Fires **before** executing against Databricks — catches truncated LLM responses without spending a retry.

### `_extract_and_validate_sql(raw) → str`
1. Strip `` ```sql `` / `` ``` `` fences
2. Enforce SELECT or WITH start
3. Block DML/DDL keywords via regex
4. Call `_check_balanced_parens`
5. Append `LIMIT 1000` if absent

### `_sql_pipeline_sync(question, schema_ctx) → (sql, rows)`
Generate → execute → on failure: fix → execute → repeat, up to `MAX_RETRIES=3`.

---

## Phase 3 — Deterministic chart engine

### `_build_widgets(rows) → list[dict]`

No LLM involved. Decision tree:

| Condition | Widget(s) produced |
|---|---|
| Empty result | Single `TABLE` with "No Results Found" |
| 1 row + numeric columns | `KPI_CARD` per numeric column + optional `TABLE` |
| Date column + numeric columns | `LINE_CHART` + `TABLE` |
| String column (≤50 unique, non-ID) + numeric | `BAR_CHART` + `TABLE` |
| Fallback | `TABLE` |

**String column selection** for bar charts: sorts candidate columns by cardinality (lowest first), skips columns matching ID/key/uuid patterns. Threshold is 50 unique values.

**Numeric coercion:** columns where ≥80% of string values parse as numbers are coerced to numeric — handles Databricks returning integers as strings.

**Widget shape:**
```json
{
  "type":   "BAR_CHART | LINE_CHART | KPI_CARD | TABLE",
  "title":  "Human readable title",
  "x_key":  "column_name_or_null",
  "y_keys": ["col_a", "col_b"] or null,
  "data":   [ { ...row... } ]
}
```

---

## Phase 4 — Narrative + lineage

### `_generate_narrative_sync(question, sql, rows) → dict`
Single LLM call (`max_tokens=500`) returning structured JSON:
```json
{
  "title":       "Short dashboard title",
  "description": "One sentence describing what this shows",
  "summary":     "1-2 sentences with specific numbers",
  "insights":    ["Insight 1", "Insight 2", "Insight 3"]
}
```
Extracts JSON via `re.search(r'\{[\s\S]*\}', raw)`. Falls back to safe defaults on any failure.

### `_extract_lineage(sql, rows, matched_schemas) → dict`
Programmatic SQL inspection (no LLM):
- **Tables used** — FQ names from `matched_schemas` found in the SQL string
- **Result columns** — `rows[0].keys()` if rows exist
- **Aggregations** — regex for `SUM|COUNT|AVG|MAX|MIN|...` followed by `(`
- **GROUP BY columns** — extracted via regex, limited to 6
- **JOIN detection** — presence of `\bJOIN\b`
- **Transformations** — human-readable list of the above + WHERE/ORDER BY flags

---

## SQL safety model

All user input goes through LLM → `_extract_and_validate_sql` → Databricks.  
The question is **never** directly interpolated into SQL. The LLM generates the SQL, and the validator enforces SELECT-only before execution.

---

## Databricks objects

| Object | Role |
|---|---|
| `marketplace_whitelist.json` | Source of truth for accessible tables |
| Any table listed in the whitelist | Read via SELECT |
| Databricks Model Serving endpoint | LLM for SQL generation and narrative |

---

## Extension notes

- **Add a new accessible table:** Append to `marketplace_whitelist.json`. No code change or restart needed — schema cache will pick it up on next request.
- **Add a new chart type:** Add a branch in `_build_widgets` and a corresponding React component in `GeniePage.jsx`.
- **Adjust self-correction retries:** Change `MAX_RETRIES` constant (default 3).
- **Adjust schema cache TTL:** Change `_SCHEMA_TTL` constant (default 600 seconds).
- **Add a new narrative field:** Add it to the `_generate_narrative_sync` prompt JSON structure, parse it from the response, include it in `_genie_sync` return dict, and render it in `DashboardCard`.
