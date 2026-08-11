# CLAUDE.md — AdoptionHub Agent Brief

> Full documentation: **PROJECT_KNOWLEDGE.md** (always read this before making architectural decisions)

---

## What this project is

**AdoptionHub** (ABeam Adoption Kit) is a full-stack internal tool for data engineers to configure and execute the NCSS Databricks medallion pipeline (Raw → Bronze → Silver) via a validated UI, without touching Databricks directly. A **Marketplace** module lets business users turn a plain-English prompt into a live Gold/Silver dashboard view with AI-generated SQL and auto-rendered charts.

---

## Tech Stack

| Layer | Tech |
|---|---|
| Backend | Python 3.10+, FastAPI 0.136, Uvicorn |
| Backend data | `databricks-sql-connector`, `openpyxl`, `pandas` |
| Backend AI | `requests` → Databricks Model Serving (OpenAI-compatible) |
| Frontend | React 19, Vite 8, react-router-dom 7 |
| UI | Tailwind CSS 3, framer-motion 12, lucide-react, recharts 3 |
| Charts | `recharts` (bar, line, stacked_bar, pie, kpi, table) |
| File input | `react-dropzone`, `@monaco-editor/react` |

---

## Repository Layout

```
AdoptionHub/
├── CLAUDE.md                         ← this file
├── PROJECT_KNOWLEDGE.md              ← full deep-dive documentation
├── backend/
│   ├── main.py                       ← FastAPI app, CORS (localhost:5173 only), router registration
│   ├── requirements.txt
│   ├── marketplace_whitelist.json    ← gates ALL Marketplace AI table access
│   └── routers/
│       ├── files.py                  ← POST /parse-file (pandas, local)
│       ├── ai.py                     ← POST /enrich-columns, /generate-dict-logic
│       ├── config.py                 ← POST /save-config, GET /configs
│       ├── volumes.py                ← POST /upload-to-volume (Databricks Files API)
│       ├── jobs.py                   ← POST /run-job, /run-bronze-to-silver, GET /job-run-status, /job-run-logs
│       ├── dictionary.py             ← POST /parse-dictionary, /upload-dictionary
│       ├── jobrun.py                 ← GET /job-run/entities, POST /job-run/run, GET /job-run/logs (Job Run module)
│       └── genie.py                  ← GET/POST /genie/* (Marketplace module backend, ~1200+ lines)
└── frontend/src/
    ├── App.jsx                       ← root layout, sidebar nav (5 items), always-mounted MetadataPage
    ├── pages/
    │   ├── MetadataPage.jsx          ← Dataset | Data Dictionary (two-tab, localStorage-persisted)
    │   ├── JobRunPage.jsx            ← Job Run module: entity selector + monitor view (~1275 lines)
    │   └── MarketplacePage.jsx       ← Marketplace module entry (wraps GenieShell)
    ├── components/
    │   ├── genie/                    ← All Marketplace UI components
    │   │   ├── GenieShell.jsx        ← Root shell: state orchestration, layout
    │   │   ├── DashboardView.jsx     ← Full dashboard: header + SQL panel + widgets + insights + lineage
    │   │   ├── DashboardHeader.jsx   ← Title, Export, Save, SQL toggle buttons
    │   │   ├── WidgetGrid.jsx        ← Responsive widget layout
    │   │   ├── ChartWidget.jsx       ← Bar + Line chart renderers + SwitchableWidget
    │   │   ├── StackedBarWidget.jsx  ← Stacked bar chart renderer
    │   │   ├── PieChartWidget.jsx    ← Pie chart renderer
    │   │   ├── KpiCard.jsx           ← Single KPI metric card
    │   │   ├── TableWidget.jsx       ← Paginated data table with filter
    │   │   ├── InsightsPanel.jsx     ← AI-generated key insights list
    │   │   ├── LineagePanel.jsx      ← Collapsible data lineage section
    │   │   ├── SchemaHint.jsx        ← Collapsible table selector with Silver/Gold tier colouring
    │   │   ├── PromptBar.jsx         ← Question input + submit
    │   │   ├── FilterBar.jsx         ← AI-extracted filter chips
    │   │   ├── SqlPanel.jsx          ← Collapsible SQL viewer
    │   │   ├── ExportMenu.jsx        ← PDF / Tableau / Power BI export
    │   │   ├── SaveModal.jsx         ← Save dashboard modal
    │   │   ├── SavedDashboardsGrid.jsx ← Grid of saved dashboard cards with load/delete
    │   │   ├── EmptyState.jsx        ← Suggestion chips for first-time use
    │   │   ├── LoadingState.jsx      ← Animated loading skeleton
    │   │   ├── ErrorState.jsx        ← Error banner
    │   │   └── NotDataQuestion.jsx   ← Non-data question response
    │   ├── ConfigSummary.jsx         ← 5-phase pipeline UI (upload → job10 → TIER1 → job20 → TIER2)
    │   ├── DictionarySection.jsx     ← 4-sheet NCSS Excel parse, enrich, upload
    │   ├── JobTimeline.jsx           ← Framer Motion task timeline
    │   ├── MetadataGrid.jsx          ← editable column metadata table
    │   └── FileDropzone.jsx          ← react-dropzone wrapper
    ├── hooks/
    │   ├── useGenieState.js          ← Marketplace ephemeral state (question, result, error, schema)
    │   ├── useGenieQuery.js          ← All /api/genie/* fetch calls
    │   └── useLocalStorage.js        ← useState + localStorage sync
    └── services/api.js               ← axios client for metadata/dictionary + Job Run flows
```

---

## Critical Patterns (never break these)

### Backend
1. **`asyncio.to_thread` for ALL blocking I/O** — `databricks-sql-connector` and `requests` are synchronous. Every DB/HTTP call must be wrapped: `await asyncio.to_thread(sync_fn, args...)`. Never call them directly from `async` route handlers.
2. **SQL sanitization** — no parameterized queries (Databricks connector limitation). Use `sql_literal()` (config.py) or `_esc()` (genie.py) for all values. Never write a raw f-string with user data into SQL.
3. **Sync helper naming** — internal helpers that block must be prefixed `_` and run via `asyncio.to_thread` (e.g., `_save_sync`, `_check_logs_sync`).
4. **Never call Databricks SQL synchronously from an async handler.**

### Frontend
5. **`MetadataPage` is always mounted** — `App.jsx` renders it unconditionally, hidden via CSS `className="hidden"` when not active. If you unmount it (e.g., with `AnimatePresence`), live polling intervals and form state are destroyed on navigation.
6. **`_idx` for row identity** — Dictionary and MetadataGrid tables stamp each row with `_idx` on load. Always match by `_idx`, never by array position.
7. **`useLocalStorage` for persistence** — all state that must survive refresh uses this hook. Keys are prefixed `ah_` (e.g., `ah_cfg`, `ah_cs`). `ConfigSummary` uses `ah_cs` namespaced by `config.job_name`. Job Run uses `ah_jr`, `ah_jr_entities`, `ah_jr_start`.
8. **Marketplace uses native `fetch`, not axios** — `useGenieQuery.js` has its own `apiFetch()`. Do not refactor Marketplace calls into `services/api.js`.
9. **Case preservation in normalization** — `normalize_column_name()` and `normalize_element_name()` do NOT call `.lower()`. Case is preserved intentionally. Do not add `.lower()`.
10. **Both MetadataPage subsections always mounted** — the Dataset and Dictionary tabs each render in a `hidden` div when inactive. Never conditionally unmount them.

### Job Run module-specific
11. **Cumulative task log upsert** — `JobRunPage.jsx` accumulates `tbl_task_run_log` rows across polls. The merge key is `task_name|job_run_id`. Always **overwrite** existing keys with the latest poll result so stale `STARTED` rows become `SUCCESS/FAILED` when Databricks updates them. Never use append-only (existingKeys set) logic.
12. **UTC timestamp handling** — `tbl_task_run_log` and `tbl_job_run_log` store times in UTC without a trailing `Z`. Always parse with `toUtcDate(iso)` which appends `'Z'` if no timezone suffix is present, so the browser converts to local time correctly.
13. **`job_run_id` encodes entity job name** — format is `YYYYMMDD_XXXX_pip_<job_name>` (e.g. `20260522_6707_pip_synthetic_data_ncss_entity`). Matching task logs to entities via `job_run_id.includes(job_name)` is the most reliable discriminator. Table-name matching is a secondary fallback only.
14. **All entities amber while Databricks job runs** — `entityStatus()` returns `'inprogress'` for ALL entities when `isJobRunning=true`, regardless of whether log rows exist yet. Green/red is only applied after the job reaches a terminal state.
15. **Multi-job_run_id log fetch (backend)** — `_fetch_run_logs_sync` fetches task logs for up to 10 distinct recent `job_run_id`s (not just the single latest). Each entity in a run gets its own `job_run_id` in `tbl_job_run_log`, so fetching only the top-1 would lose earlier entities' logs as the job advances.

### Marketplace-specific
16. **Whitelist gates all AI table access** — add tables only to `backend/marketplace_whitelist.json`. Include a human-readable `description` — AI selection quality depends on it. Read on every request, no restart needed.
17. **`_esc()` for SQL values** — single-quote escaping for all user/AI-generated values inserted into SQL strings in `genie.py`.
18. **Saved dashboard narrative stored at save time** — `tbl_genie_saved` has a `narrative_json` column. `_run_saved_sync` reads it directly — no LLM call on load. Falls back to LLM only for rows saved before this feature was added.
19. **Auto-stacked bar detection** — `_build_widgets` detects multi-dimensional data (≥2 non-ID categoricals with repeated x values) and auto-generates a `STACKED_BAR_CHART` without the user needing to say "stacked". Up to 3 charts generated per query.
20. **`pinned_tables` restricts AI table selection** — when the user deselects tables in the schema panel, `GenieShell` sends `pinned_tables: [fq_name, ...]` to `/api/genie/ask`. The backend filters `all_tables` to only the pinned set before scoring relevance.

---

## Environment Variables

### `backend/.env` (required, never committed)
```
DATABRICKS_HOST=https://<workspace>.azuredatabricks.net
DATABRICKS_TOKEN=dapi...
DATABRICKS_HTTP_PATH=/sql/1.0/warehouses/<id>
DATABRICKS_SERVING_ENDPOINT=<model-serving-endpoint-name>
```

> The AI model is accessed via **Databricks Model Serving only** (OpenAI-compatible chat format). There is no direct Anthropic SDK dependency in active code. The `anthropic` package in `requirements.txt` is a stale artefact — do not import it.

### `frontend/.env` (optional)
```
VITE_API_URL=http://localhost:8000
```

---

## Running Locally

```bash
# Backend
cd backend
python -m venv venv && .\venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload       # http://localhost:8000, Swagger: /docs

# Frontend
cd frontend
npm install
npm run dev                     # http://localhost:5173
```

---

## Key Databricks Objects

| Object | Purpose |
|---|---|
| `catalog_central.medallion_config.tbl_config` | Pipeline config rows (one per source file) — primary key: `job_name` |
| `catalog_central.utilities.tbl_job_run_log` | Job run audit (has `layer`, `job_run_id`, `start_time`) — `job_run_id` format: `YYYYMMDD_XXXX_pip_<job_name>` |
| `catalog_central.utilities.tbl_task_run_log` | Per-task log (has `job_run_id`, `task_name`, `status`, `error_message`, `start_time`, `end_time`) |
| `catalog_central.utilities.tbl_qc_result` | QC results (has `qc_result`, `failure_message`) |
| `catalog_cross_ncss.gold.tbl_genie_saved` | Marketplace saved dashboard registry (auto-created; has `narrative_json`) |
| `catalog_cross_ncss.gold.vw_genie_*` | Marketplace-generated Gold views (one per saved dashboard) |
| `/Volumes/catalog_<domain>/raw/file_upload/` | Source data files |
| `/Volumes/catalog_central/dictionary/file_upload/` | NCSS Data Dictionary Excel |

---

## AI Integration

All AI calls go through **Databricks Model Serving** with OpenAI-compatible format:
```
POST {DATABRICKS_HOST}/serving-endpoints/{DATABRICKS_SERVING_ENDPOINT}/invocations
Body: {"messages": [{"role": "user", "content": "..."}], "max_tokens": N}
Auth: Bearer {DATABRICKS_TOKEN}
```

Usage patterns:
1. **Column enrichment** (`ai.py /enrich-columns`) — descriptions, PII, classification per column
2. **SQL generation** (`ai.py /generate-dict-logic`) — technical logic text → Spark SQL expression
3. **Marketplace** (`genie.py`) — suitability check, filter extraction, text-to-SQL, narrative generation

---

## State Locations

| Where | What |
|---|---|
| React `useState` | Ephemeral session state (loading, errors, modal visibility) |
| `useLocalStorage` / `localStorage` | Form data + job state (survives page refresh) |
| Databricks Delta tables | Permanent backend truth |

---

## Common Extension Tasks

**Add a new backend router:** Create `backend/routers/myfeature.py`, register in `main.py` with `app.include_router(myfeature.router, prefix="/api")`. Always use `asyncio.to_thread` for blocking I/O.

**Add a Marketplace table:** Append to `backend/marketplace_whitelist.json` — no code change or restart needed.

**Add a job phase (e.g., job_30):** New constant in `jobs.py` → new endpoint → new fn in `api.js` → new state vars + card in `ConfigSummary.jsx`.

**Add a MetadataPage tab:** Add to `SUBSECTIONS` array + a `hidden` div block. Use `useLocalStorage` with `ah_` prefix for persistence.

**Extend the Job Run module:** Entity columns come from `ENTITY_COLS` in `jobrun.py`. Add columns there and update the `EntityTable` headers in `JobRunPage.jsx`. Log polling and entity matching logic lives in `JobRunPage.jsx` — see `matchTaskLogs` and `entityStatus`.

**Extend Marketplace charts:** Add a new chart type in `ChartWidget.jsx` (`CHART_TYPES` array + `WidgetRenderer` switch). Add a new widget component in `frontend/src/components/genie/`. Update `_build_widgets` in `genie.py` to emit the new type. Register `data-chart-card` attribute on the wrapper div for PDF export to work correctly.

**Change the AI model:** Update `DATABRICKS_SERVING_ENDPOINT` in `.env`. Endpoint must accept OpenAI-compatible chat completions format.
