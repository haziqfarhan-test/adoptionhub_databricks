# PROJECT_KNOWLEDGE.md — ABeam Adoption Kit (AdoptionHub)

---

## Project Overview

**What it does:** A full-stack internal tool that lets data engineers configure, document, and execute the ABeam NCSS medallion data pipeline on Databricks — without touching notebooks or the Databricks UI directly. A separate **Marketplace** module lets business users describe what data they want in plain English and get an AI-generated dashboard view instantly.

**Core problem it solves:** The Databricks medallion pipeline (Raw → Bronze → Silver) is config-driven via a central Delta table (`catalog_central.medallion_config.tbl_config`). Manually maintaining that table is error-prone. This app provides a guided, validated UI to:
1. Upload source files to Databricks Volumes
2. Configure all medallion metadata (Bronze/Silver paths, column types, PKs)
3. **Bulk-select and run multiple entities** via the Job Run module — sets `active` flags then triggers `job_10_raw_to_bronze` with live per-entity progress tracking
4. Trigger and monitor `job_10_raw_to_bronze` and `job_20_bronze_to_silver` with live task timelines (single-entity flow via MetadataPage)
5. Check post-run logs for errors and QC failures
6. Manage the NCSS Data Dictionary (parse, enrich, upload the 4-sheet Excel file)
7. (Marketplace) Build business-user-facing dashboards from Gold/Silver data via natural language

**Key features:**
- File parsing with auto-normalization of column names (Databricks-safe)
- AI column enrichment (descriptions, PII classification) via Databricks Model Serving
- AI-generated SQL logic for Data Dictionary entries
- AI-powered Marketplace: natural language → suggested tables → SQL view → live dashboard
- Live Databricks job run timeline (tasks, durations, states)
- TIER 1 / TIER 2 post-run log inspection
- Full state persistence: survives module navigation AND browser refresh via localStorage

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Backend runtime** | Python 3.x, FastAPI 0.136, Uvicorn |
| **Backend data** | `databricks-sql-connector 4.2.6`, `openpyxl 3.1.5`, `pandas 2.3.3` |
| **Backend AI** | `requests` → Databricks Model Serving endpoint (OpenAI-compatible `/invocations` API) |
| **Backend HTTP** | `requests 2.34` (Databricks REST APIs + Model Serving) |
| **Backend config** | `python-dotenv 1.2.2` |
| **Frontend runtime** | React 19, Vite 8 |
| **Frontend routing** | `react-router-dom 7` (BrowserRouter) |
| **Frontend animation** | `framer-motion 12` |
| **Frontend icons** | `lucide-react 1` |
| **Frontend HTTP** | `axios 1` (metadata/dictionary flows), native `fetch` (Marketplace) |
| **Frontend styling** | Tailwind CSS 3 + CSS custom properties (Apple HIG design system) |
| **Frontend file input** | `react-dropzone 15` |
| **Frontend editor** | `@monaco-editor/react 4` (used in DictionarySection for SQL editing) |
| **Frontend charts** | `recharts 3` (Marketplace: bar, line, area, pie, stacked bar, scatter, table, KPI) |
| **Infrastructure** | Databricks workspace (Unity Catalog, Volumes, Jobs API, Files API, SQL Connector, Model Serving) |

---

## Architecture

### High-Level Design

```
Browser (React SPA)
    │  axios / fetch HTTP
    ▼
FastAPI (localhost:8000)       ← CORS restricted to localhost:5173
    │
    ├─ /api/parse-file                          ← pandas file parsing (local, no Databricks)
    ├─ /api/enrich-columns                      ← Databricks Model Serving call
    ├─ /api/generate-dict-logic                 ← Databricks Model Serving call
    ├─ /api/save-config                         ← Databricks SQL MERGE
    ├─ /api/configs                             ← Databricks SQL SELECT
    ├─ /api/upload-to-volume                    ← Databricks Files API PUT
    ├─ /api/parse-dictionary                    ← openpyxl local parsing
    ├─ /api/upload-dictionary                   ← openpyxl build + Databricks Files API PUT
    ├─ /api/run-job                             ← Databricks Jobs API v2.1 run-now
    ├─ /api/run-bronze-to-silver               ← Databricks Jobs API v2.1 run-now
    ├─ /api/job-run-status/{id}                ← Databricks Jobs API v2.1 runs/get
    ├─ /api/job-run-logs                        ← Databricks SQL SELECT (tbl_job_run_log etc.)
    │
    ├─ /api/job-run/entities                   ← Job Run module: SELECT from tbl_config
    ├─ /api/job-run/run                        ← Job Run module: set active flags + trigger job_10
    ├─ /api/job-run/logs                       ← Job Run module: tbl_job_run_log + tbl_task_run_log (multi-job_run_id)
    │
    ├─ /api/genie/schema                        ← reads marketplace_whitelist.json + layer info
    ├─ /api/genie/ask                           ← Databricks Model Serving: SQL + dashboard config
    ├─ /api/genie/saved                         ← GET: list saved dashboards from tbl_genie_saved
    ├─ /api/genie/saved (POST)                  ← save dashboard (title, sql, narrative_json)
    ├─ /api/genie/saved/{id} (DELETE)           ← DELETE from tbl_genie_saved
    └─ /api/genie/saved/{id} (GET)              ← load saved dashboard (uses stored narrative_json, no LLM)
```

### Key Design Patterns

1. **`asyncio.to_thread` for all blocking I/O** — FastAPI is async, but both `databricks-sql-connector` and `requests` are synchronous. Every DB/HTTP call is wrapped: `await asyncio.to_thread(sync_fn, args...)`. This keeps the event loop non-blocked.

2. **SQL MERGE pattern for upserts** — `save-config` builds a fully inline MERGE statement (no parameterized queries; values are sanitized via `sql_literal()`) against `catalog_central.medallion_config.tbl_config` keyed on `job_name`. The marketplace router uses the same `_esc()` pattern for its registry MERGE.

3. **Databricks Files API for binary upload** — `PUT /api/2.0/fs/files{/Volumes/path}?overwrite=true` with raw bytes body. Used for both source files and the Dictionary Excel.

4. **State machine pattern in frontend** — `ConfigSummary` advances through distinct phases: `idle → uploading → done` (upload), `idle → triggering → running → done` (jobs), `idle → checking → clean/has_errors/not_found/error` (log checks). Each phase renders a different UI.

5. **`_idx` stable row identity** — The Dictionary and MetadataGrid tables assign a permanent `_idx` integer to each row on load. All mutations use `_idx` instead of array position, so filtering/sorting never corrupts updates.

6. **Always-mounted route preservation** — `MetadataPage` is rendered unconditionally in `App.jsx` and toggled with CSS `hidden` (not unmounted) so React state (including live polling intervals) survives navigation between modules.

7. **localStorage-backed state** — `useLocalStorage` hook (thin wrapper over `useState`) persists all form/job/log state. `ConfigSummary` uses a single namespaced key (`ah_cs`) keyed by `config.job_name`, so different jobs don't bleed state.

8. **Narrative-JSON save/load (Marketplace)** — Dashboard title, description, summary, and key insights are serialised as `narrative_json` at save time and stored in `tbl_genie_saved`. On load, the stored narrative is used directly — no second LLM call needed.

9. **Whitelist-driven table access (Marketplace)** — Only tables listed in `backend/marketplace_whitelist.json` are exposed to the AI. The AI never invents table names outside this list. `pinned_tables` from the frontend further restricts the set per-query.

---

## Directory & File Structure

```
AdoptionHub/
├── .gitignore                  # Excludes venv, .env, node_modules, .vs, .claude
├── PROJECT_KNOWLEDGE.md        # This file
│
├── backend/
│   ├── main.py                 # FastAPI app entry point, CORS, router registration
│   ├── requirements.txt        # Python dependencies (pinned; UTF-16 encoded — see Known Issues)
│   ├── test_conn.py            # Ad-hoc Databricks connection test script
│   ├── marketplace_whitelist.json  # Allowed tables for Marketplace AI (read by genie.py)
│   └── routers/
│       ├── files.py            # POST /parse-file — pandas file → column metadata
│       ├── ai.py               # POST /enrich-columns, POST /generate-dict-logic
│       │                       #   (calls Databricks Model Serving, not Anthropic SDK)
│       ├── config.py           # POST /save-config, GET /configs, POST /validate-columns
│       ├── volumes.py          # POST /upload-to-volume — Databricks Files API
│       ├── jobs.py             # POST /run-job, POST /run-bronze-to-silver,
│       │                       # GET /job-run-status/{run_id}, GET /job-run-logs
│       ├── dictionary.py       # POST /parse-dictionary, POST /upload-dictionary
│       ├── jobrun.py           # GET /job-run/entities, POST /job-run/run, GET /job-run/logs
│       │                       # Job Run module: bulk entity selection + trigger + live log fetch
│       └── genie.py            # GET/POST /genie/* — Marketplace module (AI query → dashboard)
│
└── frontend/
    ├── index.html
    ├── package.json
    ├── vite.config.js
    ├── tailwind.config.js      # CSS custom property tokens, Apple HIG shadows/easing
    ├── postcss.config.js
    └── src/
        ├── main.jsx            # ReactDOM root, BrowserRouter
        ├── index.css           # CSS custom properties (--brand-*, --dark-*, --ui)
        ├── App.jsx             # Layout: sticky header, sidebar nav, always-mounted MetadataPage
        ├── hooks/
        │   ├── useLocalStorage.js   # useState + localStorage sync
        │   ├── useGenieState.js     # Marketplace ephemeral state (question, result, error, schema)
        │   └── useGenieQuery.js     # Marketplace API calls (askQuestion, saveDashboard, etc.)
        ├── services/
        │   └── api.js          # Axios calls for metadata/dictionary + Job Run flows
        │                       # Note: Marketplace uses useGenieQuery.js with native fetch
        ├── pages/
        │   ├── MetadataPage.jsx     # Two-tab page: Dataset | Data Dictionary
        │   ├── JobRunPage.jsx       # Job Run module: entity selector + monitor view (~1275 lines)
        │   └── MarketplacePage.jsx  # Thin wrapper — renders <GenieShell />
        └── components/
            ├── FileDropzone.jsx     # react-dropzone wrapper (CSV/XLS/XLSX)
            ├── MetadataGrid.jsx     # Editable column metadata table
            ├── ConfigSummary.jsx    # Post-save flow: upload → job_10 → TIER1 logs → job_20 → TIER2 logs
            ├── JobTimeline.jsx      # Framer Motion task-by-task timeline with status badges
            ├── DictionarySection.jsx # Dictionary tab: parse Excel, enrich, upload
            └── genie/
                ├── GenieShell.jsx       # Root orchestrator: schema + prompt + dashboard state
                ├── PromptBar.jsx        # Question input + Ask button
                ├── SchemaHint.jsx       # Table selector: tier colour coding, collapsible rows, deselect
                ├── FilterBar.jsx        # AI-extracted active filter chips
                ├── DashboardView.jsx    # Renders KPI cards + chart grid + lineage + save button
                ├── SavedDashboardsGrid.jsx  # Saved dashboard cards with delete
                ├── SaveModal.jsx        # Modal to name and save a dashboard
                ├── ExportMenu.jsx       # Export dropdown (Tableau .twb, Power BI .csv, Print/PDF)
                ├── ChartWidget.jsx      # Bar + line chart renderers (recharts)
                ├── StackedBarWidget.jsx # Stacked bar chart renderer
                ├── PieChartWidget.jsx   # Pie chart renderer
                ├── KpiCard.jsx          # Single KPI metric card
                ├── LoadingState.jsx     # Skeleton / spinner while AI runs
                ├── ErrorState.jsx       # Error banner
                ├── EmptyState.jsx       # Prompt suggestions on initial view
                └── NotDataQuestion.jsx  # "Not a data question" fallback UI
```

---

## Core Components

### `backend/routers/files.py` — File Parser
- **Responsibility:** Parse uploaded CSV/XLS/XLSX with pandas, auto-detect column types, normalize names.
- **Key function:** `parse_file(file)` → returns `{columns, row_count, file_meta}`.
- **Normalization:** `normalize_column_name()` — spaces/dashes → underscore, strip special chars, prefix `col_` if starts with digit. **Does NOT lowercase** (preserves original case).
- **Date suffix stripping:** `clean_filename()` removes date suffixes like `_20240101` from filenames before using as table names.
- **Type mapping:** pandas dtypes → Databricks-compatible types (int64 → integer, object → string, etc.)

### `backend/routers/config.py` — Config CRUD
- **Responsibility:** Validate column names, upsert pipeline config to Databricks.
- **Key constants:** `TABLE_REF = "catalog_central.medallion_config.tbl_config"`, `MERGE_COLS` (40 column names), `DATABRICKS_RESERVED` set (50+ keywords).
- **Key function:** `_save_sync(row)` — builds and executes a fully inline MERGE SQL statement. Uses `sql_literal()` to type-safe-escape values (handles booleans, integers, strings with single-quote escaping).
- **Silver primary key** is derived from columns with `is_primary_key=True`.
- **Bronze write_mode is always `overwrite`**, **silver write_mode is always `merge`** (hardcoded business rules).
- **`remove_date_suffix()`** strips date suffixes from `source_filename` before writing to Databricks.

### `backend/routers/jobs.py` — Job Orchestration
- **Responsibility:** Manage Databricks job runs and log checking.
- **Key constants:**
  - `DB_JOB_NAME = "job_10_raw_to_bronze"`
  - `DB_JOB_NAME_20 = "job_20_bronze_to_silver"`
  - `UTILS_REF = "catalog_central.utilities"`
  - `TABLE_REF = "catalog_central.medallion_config.tbl_config"`
- **`run-job` flow:**
  1. `_update_active_sync` — sets ALL rows in tbl_config to `active=FALSE`, then sets the target row to `active=TRUE`.
  2. `_find_job_id_sync` — finds job_10's Databricks job ID via `GET /api/2.1/jobs/list?name=...`.
  3. `_trigger_job_sync` — calls `POST /api/2.1/jobs/run-now` with `job_parameters: {domain, frequency}`.
- **`_check_logs_sync(layer)`:**
  1. Queries `tbl_job_run_log` for latest `job_run_id` WHERE `layer = 'TIER 1'/'TIER 2'` ORDER BY `start_time DESC LIMIT 1`.
  2. Queries `tbl_task_run_log` WHERE `status != 'SUCCESS'` (task errors).
  3. Queries `tbl_qc_result` WHERE `qc_result != 'SUCCEEDED'` (QC failures).
  4. Returns `{found, job_run_id, task_errors[], qc_failures[]}` — rows as `SELECT *` dicts.
- **`job_run_id` safety:** handles both int and string IDs with a type check before SQL formatting.

### `backend/routers/dictionary.py` — Data Dictionary
- **Responsibility:** Parse 4-sheet NCSS Excel dictionary, build enriched rows, re-upload to Databricks.
- **Sheet routing:**
  - DD sheets: `'System Level'`, `'Domain Level - All'` → merged into `data_dictionary`
  - Code sheets: `'System - Code Table'`, `'Domain - Code Table'` → merged into `master_code`
- **`normalize_element_name()`** — same algorithm as `normalize_column_name` but preserves case (no `.lower()`).
- **Each DD row gets** `_safe_element_name` (normalized) and `_generated_sql` (empty on parse, filled by AI).
- **Upload split logic:**
  - `Dictionary Level == 'SYSTEM'` → "System Level" sheet; else → "Domain Level - All"
  - `Code Level == 'System'` → "System - Code Table" sheet; else → "Domain - Code Table"
- **`_cell_value(row, h)`** — during upload, substitutes `_safe_element_name` for "Data Element Name" and `_generated_sql` for "Dictionary Technical Logic" (if non-empty).

### `backend/routers/ai.py` — AI Enrichment
- **Responsibility:** Two AI endpoints for metadata generation. **Uses Databricks Model Serving, not the Anthropic SDK directly.**
- **`_call_serving_sync(prompt, max_tokens)`** — POSTs to `{DATABRICKS_HOST}/serving-endpoints/{DATABRICKS_SERVING_ENDPOINT}/invocations` using OpenAI-compatible chat format `{"messages": [{"role": "user", "content": prompt}]}`. Returns `choices[0].message.content`.
- **`POST /enrich-columns`** — Sends column names/types/samples to the serving endpoint, receives descriptions, PII classification, data classification. Merges result back onto original column list.
- **`POST /generate-dict-logic`** — Converts a "Dictionary Technical Logic" text spec into a Spark SQL expression. **Skips** rows where `technical_logic` is `'Align with Data Format'`, `'MASTER_CODE_LOOKUP'`, or `'Not required'`.
- **Required env var:** `DATABRICKS_SERVING_ENDPOINT` (the name of the deployed model endpoint, e.g. `databricks-meta-llama-3-3-70b-instruct`).

### `backend/routers/jobrun.py` — Job Run Module
- **Responsibility:** Bulk entity selection, `active` flag management, job triggering, and live log fetching for the Job Run module.
- **Key constants:**
  - `TABLE_REF = "catalog_central.medallion_config.tbl_config"`
  - `UTILS_REF = "catalog_central.utilities"`
  - `DB_JOB_NAME = "job_10_raw_to_bronze"`
  - `ENTITY_COLS` — the 9 columns fetched from `tbl_config` for the entity selector table
- **`GET /job-run/entities`** — `SELECT ENTITY_COLS FROM tbl_config ORDER BY source_entity_name`. Returns all rows as dicts for the selector table.
- **`POST /job-run/run`** — Accepts `{selected_job_names, domain, frequency}`. Flow:
  1. `_set_active_sync` — sets ALL rows `active=FALSE`, then selected ones `active=TRUE`.
  2. `_find_job_id_sync` — `GET /api/2.1/jobs/list?name=job_10_raw_to_bronze`.
  3. `_trigger_job_sync` — `POST /api/2.1/jobs/run-now` with `{job_id, job_parameters: {domain, frequency}}`.
  4. Returns `{status, run_id, job_id, job_name}`.
- **`GET /job-run/logs`** — `_fetch_run_logs_sync`:
  1. Fetches latest 50 rows from `tbl_job_run_log` ordered by `start_time DESC`.
  2. Collects up to **10 distinct** recent `job_run_id`s from those rows (not just the single latest).
  3. Fetches ALL `tbl_task_run_log` rows WHERE `job_run_id IN (...)`.
  - **Why 10 IDs:** each entity in a Databricks run gets its own `job_run_id` in `tbl_job_run_log`. As the pipeline advances to the next entity, the newest `job_run_id` changes. Fetching only the top-1 would cause earlier entities' task logs to disappear from the UI.

### `backend/routers/genie.py` — Marketplace Module
- **Responsibility:** End-to-end AI-powered "natural-language question → SQL view → live dashboard" flow for business users. Replaces the old `marketplace.py`.
- **Key constants:**
  - `VIEW_CATALOG = "catalog_cross_ncss"`, `VIEW_SCHEMA = "gold"` — where views are created
  - `SAVED_TABLE = "catalog_cross_ncss.gold.tbl_genie_saved"` — saved-dashboard registry
  - `WHITELIST_PATH` — `backend/marketplace_whitelist.json`
- **Startup hook:** `_ensure_genie_saved_table_sync()` runs `CREATE TABLE IF NOT EXISTS` on `tbl_genie_saved`, then attempts `ALTER TABLE ADD COLUMNS (narrative_json STRING)` for backward compatibility (swallows error if column already exists).
- **`_call_serving_sync(prompt, max_tokens)`** — identical pattern to `ai.py`, calls the Databricks serving endpoint with OpenAI-compatible chat format.
- **`_genie_sync(question, pinned_tables=None)`** — core AI pipeline:
  1. Loads whitelist from `marketplace_whitelist.json`.
  2. Filters to `pinned_tables` if provided (falls back to all if filtered set would be empty).
  3. Sends `DESCRIBE TABLE` schemas for candidate tables to the AI.
  4. AI returns `{suitable, view_sql, dashboard_title, dashboard_description, key_insights, speech_bubble_summary, filters_extracted, sql_used, matched_schemas}`.
- **`_build_widgets(rows, dashboard_title, ...)`** — converts raw SQL result rows + AI config into widget list:
  - Supports `TABLE`, `BAR_CHART`, `LINE_CHART`, `STACKED_BAR_CHART`, `PIE_CHART`, `KPI` widget types.
  - Auto-detects multi-dimensional data: if `df[x_key].nunique() < len(rows)`, the x-axis repeats → auto-pivot to `STACKED_BAR_CHART`.
  - Generates up to 3 charts per query (`charts_added` counter). Line chart and stacked bar are evaluated independently.
- **`_save_genie_dashboard_sync(..., narrative_json=None)`** — `INSERT INTO tbl_genie_saved` with `narrative_json` serialised as JSON string.
- **`_run_saved_sync(dashboard_id)`** — loads a saved dashboard by `id`; uses stored `narrative_json` (no LLM call); falls back to `_generate_narrative_sync` only when `narrative_json` has no `title` (legacy rows). Uses `_tables_from_sql(sql)` to reconstruct lineage when `matched_schemas` is absent.
- **`_delete_genie_dashboard_sync(dashboard_id)`** — `DELETE FROM tbl_genie_saved WHERE id = '...'`.
- **`_tables_from_sql(sql)`** — regex extracts table names from FROM/JOIN clauses; used to fix blank "Tables Used" on saved dashboard load.
- **`_safe_view_name(s)`** — normalises to lowercase, underscores only, max 64 chars, always prefixed `vw_genie_`.
- **`_esc(s)`** — single-quote-escapes string values for inline SQL (no parameterized queries in the Databricks connector).
- **Endpoints:**
  - `GET /api/genie/schema` — returns whitelist tables with `{table, description, columns[], layer}` (layer = "silver"/"gold" from whitelist `schema` field)
  - `POST /api/genie/ask` — accepts `{question, pinned_tables[]}`, runs `_genie_sync`, builds widgets, returns full dashboard response
  - `GET /api/genie/saved` — lists all saved dashboards
  - `POST /api/genie/saved` — saves a dashboard (`GenieSaveRequest`: title, description, question, sql_used, narrative_json)
  - `GET /api/genie/saved/{dashboard_id}` — loads a saved dashboard (re-queries data from the view, uses stored narrative)
  - `DELETE /api/genie/saved/{dashboard_id}` — deletes a saved dashboard

### `backend/marketplace_whitelist.json` — Marketplace Table Whitelist
- JSON array of `{catalog, schema, table, description, domain}` objects. The `schema` field ("silver" or "gold") drives tier colour coding in `SchemaHint.jsx`.
- Currently includes 4 tables across `catalog_sg` (silver + gold) and `catalog_pg` (silver).
- **This file gates all Marketplace AI access** — the AI only sees and suggests tables listed here.
- Add new tables by appending entries; no code changes required. Always include a detailed `description` — AI table-selection quality depends on it.

### `backend/routers/volumes.py` — File Upload
- **Responsibility:** Upload a binary file to a Databricks Volume path.
- **Mechanism:** `PUT /api/2.0/fs/files{/Volumes/catalog/schema/volume/filename}?overwrite=true` with raw bytes body and Bearer token.

### `frontend/src/App.jsx` — Root Layout
- **Layout:** `h-screen overflow-hidden` container → sticky frosted-glass header → flex row (fixed sidebar + scrollable main).
- **Sidebar:** 5 nav links: Metadata & Dictionary (`/`), Job Run (`/jobrun`), Marketplace (`/marketplace`), Data Profiling, Gold Modelling. Data Profiling and Gold Modelling are "coming soon."
- **`MetadataPage` is always mounted** inside `<div className={location.pathname !== '/' ? 'hidden' : ''}>` — this is what preserves state across module navigation.
- **Job Run and Marketplace are live routes:** `<Route path="/jobrun" element={<JobRunPage />} />` and `<Route path="/marketplace" element={<MarketplacePage />} />`. Both are fully implemented.
- **Marketplace icon:** `Sparkles` from lucide-react.
- **Theme toggle:** toggles `.dark` class on `<html>`, persists to `localStorage('theme')`.

### `frontend/src/pages/MetadataPage.jsx` — Main Page
- **Persisted state** (via `useLocalStorage`): `activeTab`, `step`, `columns`, `saved`, `cfg`.
- **Ephemeral state** (via `useState`): `loading`, `aiLoading`, `uploadedFile`, `validationErrors`.
- **`step` state machine:** `'upload'` → `'edit'` → `'saved'`.
- **Cfg derivation `useEffect`:** watches `cfg.domain` and `cfg.silver_table_name`, auto-derives catalog names, archive paths, Silver paths.
- **Two subsections rendered always** (both mounted, inactive one `hidden`): Dataset tab and Dictionary tab.
- **`handleReset()`** resets all persisted state to defaults AND calls `setActiveTab('dataset')`.

### `frontend/src/pages/MarketplacePage.jsx` — Marketplace Entry Point
- **Thin wrapper** (4 lines) — imports and renders `<GenieShell />`. No logic of its own.
- All Marketplace UI and state lives in `frontend/src/components/genie/`.

### `frontend/src/components/genie/GenieShell.jsx` — Marketplace Orchestrator
- **Root component** for the Marketplace module. Owns all module-level state via `useGenieState` and all API calls via `useGenieQuery`.
- **State:** `question`, `loading`, `result`, `error`, `schema` (from `useGenieState`), `selectedTables` (initialized to all tables on first schema load), `savedRefresh` counter.
- **`handleAsk()`** — passes `pinned_tables: []` when all tables are selected (backend uses full whitelist), otherwise passes the filtered subset.
- **`onSaveDashboard(title)`** — serialises full `narrative_json` (title, description, summary, insights) and passes to `saveDashboard`.
- **Renders:** `SchemaHint` → `PromptBar` → `FilterBar` → `LoadingState | ErrorState | DashboardView | NotDataQuestion` → `SavedDashboardsGrid + EmptyState` (when no active result).

### `frontend/src/components/genie/SchemaHint.jsx` — Table Selector
- **Props:** `{tables, selectedTables, onSelectionChange}`.
- **Tier colour coding:** silver → slate colours, gold → amber colours (driven by `layer` field from `GET /api/genie/schema`).
- **Rows collapsed by default** — shows checkbox + tier badge + table name + expand chevron. Expanded row shows fq_name, description, column chips.
- **Header:** shows `N/M selected` count and an amber "filtered" badge when not all tables are selected.
- **Guard:** cannot deselect the last table (`selectedTables.length === 1` prevents it).
- **`selectAll()`** button resets selection to all fq_names.

### `frontend/src/components/genie/DashboardView.jsx` — Dashboard Renderer
- **Props:** `{result, onSave}` — renders the full AI-generated dashboard.
- **Widgets:** maps `result.widgets[]` to chart components (`ChartWidget`, `StackedBarWidget`, `PieChartWidget`, `KpiCard`).
- **Lineage panel:** lists tables used (`result.matched_schemas` or parsed from `result.sql_used` via `_tables_from_sql`).
- **Save button:** opens `SaveModal` → calls `onSave(title)` → triggers `saveDashboard` in `useGenieQuery`.
- **Export:** renders `ExportMenu` with `widgets` and `title` props.
- **`id="genie-dashboard"`** — used by `ExportMenu.handlePrint()` to scope print CSS.

### `frontend/src/components/genie/ExportMenu.jsx` — Export Dropdown
- **Options:** Tableau Workbook (`.twb`), Power BI Data (`.csv`), Save as PDF.
- **Print fix:** captures `getBoundingClientRect()` of every `.recharts-responsive-container` before print styles shift the layout, pins explicit pixel dimensions, calls `window.print()`, then restores original styles after 1 s.

### `frontend/src/components/genie/SavedDashboardsGrid.jsx` — Saved Dashboards
- **Loads** from `GET /api/genie/saved` on mount and on `refreshTrigger` change.
- **Delete:** hover-revealed `Trash2` button; calls `onDelete(id)` then removes the card optimistically from local state. `flex min-w-0` layout prevents the view-name badge from overflowing the delete button.

### `frontend/src/hooks/useGenieQuery.js` — Marketplace API Layer
- Uses native `fetch` (not axios). `apiFetch(path, opts)` is the shared helper.
- **`askQuestion(question, pinnedTables=[])`** — `POST /api/genie/ask` with `{question, pinned_tables}`.
- **`saveDashboard({title, description, question, sql_used, narrative_json})`** — `POST /api/genie/saved`.
- **`deleteDashboard(id)`** — `DELETE /api/genie/saved/${id}`.
- **`fetchSaved()`** — `GET /api/genie/saved`.
- **`loadSaved(id)`** — `GET /api/genie/saved/${id}`, sets `result` so `GenieShell` transitions to dashboard view.
- **`refreshSchema()`** — `GET /api/genie/schema`, sets `schema` array.

### `frontend/src/hooks/useGenieState.js` — Marketplace Ephemeral State
- Thin hook exposing `question/setQuestion`, `loading/setLoading`, `result/setResult`, `error/setError`, `schema/setSchema` via `useState`. No persistence — state resets on navigation.

### `frontend/src/pages/JobRunPage.jsx` — Job Run Module
- **Self-contained** (~1275 lines) — all entity-selection, monitoring, and log-inspection UI is in this one file. Uses `listJobRunEntities`, `runJobEntities`, `getJobRunLogsAll`, and `getJobRunStatus` from `services/api.js`.
- **Two UI stages:**
  - **Entity selector** (`stage = 'idle'`): filterable table of all entities from `tbl_config` with domain/frequency dropdowns and checkbox selection. Selecting entities and clicking "Run" calls `POST /job-run/run`.
  - **Monitor view** (`stage = 'running' | 'done'`): overall status banner → Databricks task timeline (`DatabricksTaskRow`) → horizontal entity progress cards (`HorizontalTracker`) → collapsible raw log tables (`JobRunLogTable`).
- **localStorage keys:** `ah_jr` (run info), `ah_jr_entities` (selected entity list), `ah_jr_start` (run trigger timestamp in ms). All three are written at run start and cleared on "New Run". The page restores its running state after browser refresh.
- **Polling:** `setInterval` every 5 seconds calling `getJobRunStatus(run_id)` and `getJobRunLogsAll()` in parallel. Stops when `life_cycle_state` reaches a terminal state (`TERMINATED`, `SKIPPED`, `INTERNAL_ERROR`).
- **Cumulative task log upsert** (`cumulativeTaskLogsRef`): a `useRef` map keyed on `task_name|job_run_id`. Each poll **overwrites** existing entries with the latest version so `STARTED` rows become `SUCCESS/FAILED` as Databricks updates them. Rows with `start_time` more than 10 minutes before the run trigger are filtered out to discard stale data from prior runs.
- **`matchTaskLogs(taskLogs, entity)`** — matches `tbl_task_run_log` rows to an entity by:
  1. Primary: `job_run_id.includes(entity.job_name)` — the job_run_id format `YYYYMMDD_XXXX_pip_<job_name>` embeds the job name, making this the most precise discriminator.
  2. Secondary: `table_name === entity.source_entity_name` or `table_name === entity.silver_table_name`.
- **`entityStatus(entity, taskLogs, isJobRunning)`** — returns `'pending' | 'inprogress' | 'success' | 'failed'`:
  - Always `'inprogress'` while the Databricks job is running (regardless of log data).
  - After job ends: `'failed'` if ANY matched row has `status != 'SUCCESS'` or a non-empty `error_message`; `'success'` if ALL rows are `SUCCESS` with no errors; `'pending'` if no rows matched.
- **`toUtcDate(iso)`** — appends `'Z'` to timestamp strings that lack a timezone suffix (DB stores UTC without marker) so the browser parses them as UTC and displays in local time.
- **`EntityCard`** — clickable card per entity. Shows status dot (grey/amber pulsing/green/red), entity name, domain/load-type pills, start time from first log row. Clicking expands an `EntityDetailPanel` with a full task log table for that entity.
- **`DatabricksTaskRow`** — collapsible section showing the raw Databricks job tasks (from `jobStatus.tasks`) as a horizontal pill timeline. Each pill shows task key, state icon, duration, and an "Open in Databricks" link.

### `frontend/src/components/ConfigSummary.jsx` — Post-Save Pipeline UI
- **localStorage key:** `'ah_cs'` namespaced by `config.job_name`. Reads initial state via `readCSState()` on mount. Saves all state changes via `useEffect`. Calls `clearCSState()` on reset.
- **5-phase pipeline rendered sequentially:**
  1. Upload to Volume card (always visible after save)
  2. Run job_10 card (visible when `uploadPhase === 'done'`)
  3. TIER 1 Log Check panel (visible when `jobPhase === 'done' && !jobFailed && log1Phase !== 'idle'`)
  4. Run job_20 card (visible when `log1Phase === 'clean'`)
  5. TIER 2 Log Check panel (visible when `job2Phase === 'done' && !job2Failed && log2Phase !== 'idle'`)
- **Polling:** `setInterval` every 5s against `/api/job-run-status/{run_id}`. Clears on TERMINAL_STATES (`TERMINATED`, `SKIPPED`, `INTERNAL_ERROR`). **Auto-restarts after browser refresh** because `jobPhase='running'` is restored from localStorage and the existing `useEffect` triggers.
- **Auto-trigger log checks:** `useEffect` watches `jobPhase + jobStatus`; fires `checkLogs1()` with a 2s delay after job succeeds.
- **File-not-available handling:** If `uploadPhase='idle'` but `file` prop is null (page refreshed), shows an amber message instead of a disabled upload button.

### `frontend/src/components/JobTimeline.jsx` — Job Visualization
- **Props:** `{status, runId}` — `status` is the raw `/job-run-status` response.
- **Tasks sorted** by `start_time` ascending; pending tasks (no start_time) stay at end.
- **5 visual states per task:** RUNNING (spinning + ping), TERMINATED/SUCCESS (green), TERMINATED/FAIL (red), SKIPPED (grey minus), PENDING (empty circle).
- **Connector line** between tasks: green gradient if task succeeded, grey otherwise.
- **`RunHeader`** shows overall job state, duration, and "Open in Databricks" link.

### `frontend/src/components/DictionarySection.jsx` — Dictionary Tab
- **Inner tabs:** "Data Dictionary" (merged System + Domain Level sheets) and "Master Code" (merged Code Table sheets).
- **Domain filter:** dropdown (unique values from `Dictionary Domain` column + "All"), resets page to 0 on change.
- **`_idx` pattern:** each row stamped with `_idx: i` on load; `handleChangeDdRow(origIdx, key, val)` matches by `row._idx !== origIdx` to build updated array.
- **Auto-normalize:** when "Data Element Name" is edited, `_safe_element_name` is immediately recomputed client-side.
- **Validation:** same `DB_RESERVED` set + `validateColName()` as MetadataGrid — red input + AlertCircle + error message for invalid normalized names.
- **AI SQL generation:** `handleGenerateSQL(origIdx)` calls `/api/generate-dict-logic` with element name, technical logic, data type, data format; tracks `generating` Set of active origIdx values for per-row loading state.
- **Pagination:** 50 rows per page.
- **Upload:** POSTs all rows (with normalized name + generated SQL applied) to `/api/upload-dictionary`.

### `frontend/src/hooks/useLocalStorage.js`
- Thin wrapper: `useState` initializer reads from `localStorage`; `useEffect` writes back on every value change.
- Supports functional updates (`setValue(prev => ...)`) because it wraps standard React `useState`.
- Silent on quota errors.

### `frontend/src/services/api.js`
- Single file exporting all API functions using axios. Base URL: `VITE_API_URL` env var or `http://localhost:8000`.
- Metadata/dictionary functions: `parseFile`, `enrichWithAI`, `saveConfig`, `listConfigs`, `uploadToVolume`, `runJob`, `getJobRunStatus`, `parseDictionary`, `generateDictLogic`, `uploadDictionary`, `getJobRunLogs`, `runBronzeToSilver`.
- Job Run functions: `listJobRunEntities` (`GET /api/job-run/entities`), `runJobEntities` (`POST /api/job-run/run`), `getJobRunLogsAll` (`GET /api/job-run/logs`).
- **Does NOT contain Marketplace functions** — Marketplace uses `useGenieQuery.js` with native `fetch`.

---

## Data Flow

### Dataset Pipeline (happy path)

```
1. User drops CSV/XLSX
   → POST /api/parse-file
   → Backend: pandas reads file, auto-normalizes column names
   → Frontend: MetadataPage step='edit', columns[] populated

2. (Optional) AI Enrichment
   → POST /api/enrich-columns
   → Databricks Model Serving fills description, PII, classification per column
   → Frontend: columns[] updated in-place

3. User configures form fields (domain, table names, PKs, etc.)
   → All paths auto-derived via cfg useEffect

4. User clicks "Save config row"
   → POST /api/save-config
   → Backend: builds MERGE SQL, upserts into tbl_config on Databricks
   → Frontend: step='saved', ConfigSummary renders

5. User uploads file
   → POST /api/upload-to-volume (multipart)
   → Backend: PUT to Databricks Files API at source_path
   → Frontend: uploadPhase='done'

6. User runs job_10_raw_to_bronze
   → POST /api/run-job {job_name_config, domain, frequency}
   → Backend:
     a. UPDATE tbl_config SET active=FALSE (all rows)
     b. UPDATE tbl_config SET active=TRUE WHERE job_name = target
     c. GET /api/2.1/jobs/list?name=job_10_raw_to_bronze → job_id
     d. POST /api/2.1/jobs/run-now {job_id, job_parameters}
   → Frontend: runId stored, polling starts (5s interval)

7. Polling: GET /api/job-run-status/{run_id}
   → Databricks GET /api/2.1/jobs/runs/get
   → Frontend: JobTimeline updates in real-time
   → On TERMINATED: polling stops, jobPhase='done'

8. TIER 1 log check (auto, 2s after job success)
   → GET /api/job-run-logs?layer=TIER+1
   → Backend: queries tbl_job_run_log → latest job_run_id
             queries tbl_task_run_log WHERE status != 'SUCCESS'
             queries tbl_qc_result WHERE qc_result != 'SUCCEEDED'
   → Frontend: log1Phase='clean' or 'has_errors'

9. (If clean) User runs job_20_bronze_to_silver
   → POST /api/run-bronze-to-silver {domain, frequency}
   → Same polling pattern → TIER 2 log check
```

### Data Dictionary Pipeline

```
1. User uploads NCSS_Data_Dictionary.xlsx
   → POST /api/parse-dictionary
   → Backend: openpyxl reads 4 sheets, merges DD sheets + Code sheets separately
              Adds _safe_element_name (normalized) and _generated_sql='' per row
   → Frontend: ddRows[] and mcRows[] with _idx stamps

2. (Optional per row) AI SQL generation
   → POST /api/generate-dict-logic
   → Databricks Model Serving returns Spark SQL expression for the technical logic field
   → Frontend: row._generated_sql updated

3. User reviews, edits, filters by domain

4. User uploads to Databricks
   → POST /api/upload-dictionary {data_dictionary, master_code, filename}
   → Backend:
     a. openpyxl builds new workbook
     b. Splits rows back to original 4 sheets via discriminators
     c. _cell_value() substitutes normalized names + generated SQL
     d. PUT to Databricks Files API at /Volumes/catalog_central/dictionary/file_upload
```

### Job Run Pipeline (bulk multi-entity flow)

```
1. User opens /jobrun
   → GET /api/job-run/entities
   → Backend: SELECT ENTITY_COLS FROM tbl_config ORDER BY source_entity_name
   → Frontend: EntityTable renders all entities with checkboxes

2. User ticks entities, sets domain + frequency, clicks "Run"
   → POST /api/job-run/run {selected_job_names, domain, frequency}
   → Backend:
     a. UPDATE tbl_config SET active=FALSE (all rows)
     b. UPDATE tbl_config SET active=TRUE WHERE job_name IN (selected)
     c. GET /api/2.1/jobs/list?name=job_10_raw_to_bronze → job_id
     d. POST /api/2.1/jobs/run-now {job_id, job_parameters: {domain, frequency}}
   → Frontend: stores run_id/job_id/job_name in localStorage (ah_jr),
               stores selected entities in localStorage (ah_jr_entities),
               stores trigger timestamp in localStorage (ah_jr_start),
               transitions to monitor view (stage='running')

3. Polling every 5s:
   a. GET /api/job-run-status/{run_id}
      → Databricks GET /api/2.1/jobs/runs/get
      → Updates OverallStatusBanner and DatabricksTaskRow
   b. GET /api/job-run/logs
      → Backend: latest 50 tbl_job_run_log rows + task rows for up to 10 distinct job_run_ids
      → Frontend: upserts into cumulativeTaskLogsRef by task_name|job_run_id key
                  EntityCards re-render with latest status per entity

4. On terminal state (TERMINATED/SKIPPED/INTERNAL_ERROR):
   → Polling stops, stage='done'
   → entityStatus() evaluates each entity: green (all SUCCESS) / red (any failure)
   → JobRunLogTable renders collapsible raw log tables

5. User clicks "New Run"
   → Clears localStorage keys, resets all state, returns to entity selector
```

### Marketplace Pipeline

```
1. User opens /marketplace
   → GET /api/genie/schema
   → Backend: reads marketplace_whitelist.json, returns [{table, description, columns[], layer}]
   → Frontend: SchemaHint renders tier-coloured table list; all tables selected by default

2. User (optionally) deselects tables in SchemaHint, then types a question + clicks Ask
   → POST /api/genie/ask {question, pinned_tables[]}
   → Backend (_genie_sync):
     a. Filters whitelist to pinned_tables (or uses all if empty)
     b. DESCRIBE TABLE for each candidate table → real column schemas
     c. AI returns {suitable, view_sql, dashboard_title, dashboard_description,
                    key_insights, speech_bubble_summary, filters_extracted, sql_used, matched_schemas}
     d. Executes view_sql as SELECT query (LIMIT 5000)
     e. _build_widgets(): auto-detects chart types, builds up to 3 charts
   → Frontend: result populated, DashboardView renders

3. DashboardView renders:
   - Speech bubble summary + key insights panel
   - KPI cards
   - Chart widgets (TABLE, BAR_CHART, LINE_CHART, STACKED_BAR_CHART, PIE_CHART)
   - Data lineage panel (tables used)
   - Export menu (Tableau .twb, Power BI .csv, Save as PDF)
   - Save button → opens SaveModal

4. (Optional) User saves dashboard
   → POST /api/genie/saved {title, description, question, sql_used, narrative_json}
   → Backend: INSERT INTO tbl_genie_saved (narrative_json stored as JSON string)
   → Frontend: SavedDashboardsGrid refreshes

5. (Optional) User loads a saved dashboard card
   → GET /api/genie/saved/{id}
   → Backend: SELECT from tbl_genie_saved; parse narrative_json (no LLM call);
              re-query view SQL to get fresh data rows
   → Frontend: result populated (same DashboardView path as step 3)

6. (Optional) User deletes a saved dashboard
   → DELETE /api/genie/saved/{id}
   → Frontend: card removed optimistically
```

---

## Configuration & Environment

### Backend `.env` (required, never committed)
```
DATABRICKS_HOST=https://<workspace>.azuredatabricks.net
DATABRICKS_TOKEN=dapi...
DATABRICKS_HTTP_PATH=/sql/1.0/warehouses/<id>
DATABRICKS_SERVING_ENDPOINT=<endpoint-name>   # e.g. databricks-meta-llama-3-3-70b-instruct
```

> **Note:** `ANTHROPIC_API_KEY` is no longer required. AI calls now go through `DATABRICKS_SERVING_ENDPOINT`. The `anthropic` package is still listed in `requirements.txt` (historical artefact) but is not imported by any active router.

### Frontend `.env` (optional)
```
VITE_API_URL=http://localhost:8000   # defaults to this if not set
```

### Tailwind CSS Custom Properties
Defined in `frontend/src/index.css`. Two sets of CSS vars — light mode (default) and `.dark` mode:
- `--brand-{50,400,500,600,700}` — Apple Blue (#0071E3)
- `--dark-{50..950}` — Inverted greyscale scale (dark-50 = near-white in dark mode)
- `--ui` — 0,0,0 in light mode / 255,255,255 in dark mode (for opacity-based borders)
- All colors exposed as Tailwind tokens via `rgb(var(--token) / <alpha-value>)` pattern.

### Build/Run
```bash
# Backend
cd backend
python -m venv venv
venv\Scripts\activate          # Windows
pip install -r requirements.txt
uvicorn main:app --reload      # http://localhost:8000

# Frontend
cd frontend
npm install
npm run dev                    # http://localhost:5173
```

---

## External Dependencies

| Service | How Used | Auth |
|---|---|---|
| **Databricks SQL Warehouse** | `tbl_config` CRUD, log table queries, marketplace registry | `DATABRICKS_TOKEN` + `DATABRICKS_HTTP_PATH` via SQL Connector |
| **Databricks Files API** | Upload source files + Dictionary Excel to Volumes | `DATABRICKS_TOKEN` in Bearer header |
| **Databricks Jobs API v2.1** | List jobs, trigger runs, poll run status | `DATABRICKS_TOKEN` in Bearer header |
| **Databricks Model Serving** | Column enrichment, SQL generation, table suggestion, view generation | `DATABRICKS_TOKEN` in Bearer header, OpenAI-compatible API |

### Databricks Delta Tables (all under `catalog_central`)
| Table | Purpose |
|---|---|
| `medallion_config.tbl_config` | Pipeline config rows (one per source file) — primary key: `job_name` |
| `utilities.tbl_job_run_log` | Job run audit log (`layer`, `job_run_id`, `start_time`). `job_run_id` format: `YYYYMMDD_XXXX_pip_<job_name>`. One row per entity per run. |
| `utilities.tbl_task_run_log` | Per-task execution log (`job_run_id`, `task_name`, `table_name`, `status`, `error_message`, `start_time`, `end_time`). Times stored as UTC without trailing `Z`. |
| `utilities.tbl_qc_result` | QC check results (has `batch_job_id`, `qc_result`, `failure_message`) |
| `catalog_cross_ncss.gold.tbl_genie_saved` | Marketplace saved-dashboard registry (auto-created on app startup; has `narrative_json STRING` column) |

### Databricks Volume Paths
| Path | Purpose |
|---|---|
| `/Volumes/catalog_<domain>/raw/file_upload/` | Source data files (domain-specific) |
| `/Volumes/catalog_central/dictionary/file_upload/` | NCSS Data Dictionary Excel |

### Marketplace Databricks Catalog
| Object | Purpose |
|---|---|
| `catalog_cross_ncss.gold.vw_genie_*` | All Marketplace-generated Gold views live here (prefix enforced by `_safe_view_name()`) |
| `catalog_cross_ncss.gold.tbl_genie_saved` | Saved dashboard registry |

---

## Key Workflows

### Adding a New Databricks Job Endpoint
1. Add a constant in `jobs.py`: `DB_JOB_NAME_30 = "job_30_..."`
2. Add a Pydantic request model if params differ.
3. Add endpoint using `_find_job_by_name_sync` + `_trigger_job_sync` (both already generic).
4. Add a corresponding API function in `frontend/src/services/api.js`.
5. Wire the UI into `ConfigSummary.jsx` following the existing phase-card pattern.

### Adding a New Log Check Layer
1. Update the `layer` validation in `GET /job-run-logs` to allow the new value.
2. Adjust the SQL query in `_check_logs_sync` if the new layer uses different table columns.
3. Add new state variables and `LogCheckPanel` in `ConfigSummary.jsx`.

### Adding a New Module/Route
1. Add a nav entry to the `nav` array in `App.jsx`.
2. Add a `<Route path="/newpath" element={<NewPage />} />` in the `Routes` block.
3. Create the page component in `frontend/src/pages/`.
4. Note: only `MetadataPage` gets the always-mounted treatment — other pages unmount normally.

### Adding Tables to the Marketplace Whitelist
1. Open `backend/marketplace_whitelist.json`.
2. Append a new entry: `{"catalog": "...", "schema": "silver|gold", "table": "...", "description": "...", "domain": "..."}`.
3. No code changes or restarts required — the file is read on every request.
4. Write a detailed `description` — the AI uses it to decide relevance for user prompts.
5. Set `"schema": "gold"` or `"schema": "silver"` — this drives tier colour coding in `SchemaHint.jsx`.

### Changing the AI Model (Databricks Serving Endpoint)
1. Deploy a new model endpoint in the Databricks workspace.
2. Update `DATABRICKS_SERVING_ENDPOINT` in `backend/.env`.
3. The endpoint must support the OpenAI-compatible chat format: `POST /serving-endpoints/{name}/invocations` with `{"messages": [...], "max_tokens": N}`.

---

## Known Patterns & Conventions

### Column Normalization Rules (Python and JS are identical)
1. `.strip()` leading/trailing whitespace
2. `[ \-/\\]+` → `_`
3. Remove `'()[]{}.,;:!?@#$%^&*+=~\`"` characters
4. Remove anything not `[a-zA-Z0-9_]`
5. Collapse `_+` → `_`
6. Strip leading/trailing `_`
7. If starts with digit → prefix `col_`
8. Empty → `"unnamed"`
9. **No `.lower()` — case preserved throughout**

### Naming Conventions
- **Backend routers:** one file per concern (`files`, `ai`, `config`, `volumes`, `jobs`, `dictionary`, `jobrun`, `genie`)
- **Sync helpers:** prefixed with `_`, e.g. `_save_sync`, `_check_logs_sync`. Always run via `asyncio.to_thread`.
- **Pydantic models:** PascalCase, co-located with their router file
- **Frontend localStorage keys:** prefixed `ah_` (project scope), e.g. `ah_step`, `ah_cfg`, `ah_cs`
- **React state phases:** string literals like `'idle'|'uploading'|'done'|'error'`
- **CSS:** Tailwind utility classes only; no separate CSS modules; custom tokens via `tailwind.config.js`
- **Marketplace view names:** always start with `vw_genie_`, lowercase underscores, max 64 chars (enforced by `_safe_view_name()` in `genie.py`)

### Frontend Patterns
- **Framer Motion entry animations:** always `initial={{opacity:0, y:8/12}} animate={{opacity:1, y:0}} transition={{ease:[0.25,1,0.5,1]}}` — Apple spring easing.
- **Card primitive:** `<Card className="">` wrapping with `<CardHeader title subtitle action>` — reused across ConfigSummary and LogCheckPanel.
- **No global state manager** — all state is component-local, with localStorage as persistence layer.
- **Parallel data fetching:** not used (all flows are sequential by business logic).
- **Marketplace uses `fetch` not axios** — `useGenieQuery.js` uses native `fetch` via `apiFetch()`. Do not refactor these calls into `services/api.js`.

### Job Run Module Patterns
- **`job_run_id` format** — `YYYYMMDD_XXXX_pip_<job_name>` (e.g. `20260522_6707_pip_synthetic_data_ncss_entity`). The entity's `job_name` from `tbl_config` is embedded in the ID. Use `job_run_id.includes(job_name)` to match task log rows to entities.
- **Cumulative upsert, not append** — task log rows are upserted into `cumulativeTaskLogsRef` by `task_name|job_run_id`. This replaces stale `STARTED` rows when Databricks updates them. Never revert to append-only (existingKeys set) logic.
- **All entities amber while running** — `entityStatus()` must return `'inprogress'` for ALL entities whenever `isJobRunning=true`. Status evaluation only runs after the job terminates.
- **UTC without Z** — `tbl_task_run_log` and `tbl_job_run_log` timestamps are UTC without a `Z` suffix. Always use `toUtcDate(iso)` which appends `'Z'` before passing to `new Date()`.
- **Multi-job_run_id backend fetch** — `_fetch_run_logs_sync` must fetch task logs for multiple distinct `job_run_id`s (up to 10), because each entity writes its own ID to `tbl_job_run_log`. Fetching only the single latest would lose earlier entities' logs.
- **Run state survives refresh** — `ah_jr`, `ah_jr_entities`, `ah_jr_start` in localStorage restore the monitor view and resume polling after a page refresh mid-run.

---

## Potential Issues / Risks

1. **No authentication on the FastAPI backend.** CORS is set to `localhost:5173` only, which limits exposure, but there is no token/session auth. Any process on the same machine can call the API.

2. **SQL injection surface in `config.py`, `jobs.py`, and `genie.py`.** Values go through `sql_literal()` (config.py) or `_esc()` (genie.py) helpers. If a new developer adds a raw f-string without these helpers, injection is possible.

3. **`_check_logs_sync` assumes `job_run_id` is an integer.** There is a type check (`isinstance(job_run_id, (int, float))`), but if the column is a UUID string in a future schema change, the fallback adds quotes — meaning the WHERE clause might fail silently or return no rows.

4. **`normalize_column_name` is duplicated** across `backend/routers/files.py`, `backend/routers/config.py`, and `backend/routers/dictionary.py`. These are byte-for-byte identical — could be extracted to a shared `utils.py`.

5. **No error boundary in the React app.** An uncaught render error in `DictionarySection` or `MarketplacePage` (e.g., malformed AI JSON) could white-screen the entire app.

6. **`uploadedFile` (File object) is not serializable.** If the user refreshes the page with `uploadPhase='idle'` before uploading (step='saved'), the upload button shows an amber message asking them to restart. The file must be re-selected — this is a known limitation by design.

7. **CORS is hardcoded to `localhost:5173`** in `main.py`. Deploying to a non-local environment requires updating `allow_origins`.

8. **`files/` directory in backend** is git-ignored but not cleaned up automatically. Uploaded files accumulate locally with no TTL.

9. **`requirements.txt` has spaced characters** (appears to be UTF-16 encoded). On some systems this may cause `pip install -r requirements.txt` to fail. Regenerate with `pip freeze > requirements.txt` on a UTF-8 terminal if issues arise.

10. **`anthropic` package in requirements.txt is unused.** The `ai.py` router now calls the Databricks serving endpoint via `requests`. The `anthropic` import and `ANTHROPIC_API_KEY` env var are no longer needed. The package entry in requirements.txt is a stale artefact.

11. **Marketplace `_ensure_genie_saved_table_sync` runs at every app startup.** The `ALTER TABLE ADD COLUMNS` call (for `narrative_json`) swallows errors silently — intentional for backward compat but means schema errors during startup won't surface.

12. **Marketplace views are not cleaned up from Unity Catalog when a saved dashboard is deleted.** `DELETE /api/genie/saved/{id}` removes the registry row but does not `DROP VIEW`. The Gold view remains in `catalog_cross_ncss.gold` until manually dropped.

---

## How to Run the Project

### Prerequisites
- Python 3.10+
- Node.js 18+
- Databricks workspace with SQL Warehouse + appropriate Unity Catalog permissions
- Databricks Model Serving endpoint deployed (OpenAI-compatible chat API)
- Write access to `catalog_cross_ncss.gold` (for Marketplace view creation)

### Backend
```bash
cd backend
python -m venv venv
# Windows:
.\venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

pip install -r requirements.txt

# Create .env file:
# DATABRICKS_HOST=https://<workspace>.azuredatabricks.net
# DATABRICKS_TOKEN=dapi...
# DATABRICKS_HTTP_PATH=/sql/1.0/warehouses/<id>
# DATABRICKS_SERVING_ENDPOINT=<model-serving-endpoint-name>

uvicorn main:app --reload
# Runs on http://localhost:8000
# Swagger UI: http://localhost:8000/docs
```

### Frontend
```bash
cd frontend
npm install
# Optional: create .env with VITE_API_URL=http://localhost:8000
npm run dev
# Runs on http://localhost:5173
```

---

## Extension Guide

### Adding a new backend router
1. Create `backend/routers/myfeature.py` with `router = APIRouter()`.
2. Register in `backend/main.py`: `from routers import myfeature` + `app.include_router(myfeature.router, prefix="/api")`.
3. Follow the `asyncio.to_thread` pattern for any blocking I/O.

### Adding a new API call to the frontend
1. Add a function to `frontend/src/services/api.js` (all metadata/dictionary/Job Run API calls go here).
2. **Exception:** Marketplace calls use `apiFetch()` inside `useGenieQuery.js`. Keep them there for self-containment.

### Adding a new tab to MetadataPage
1. Add an entry to the `SUBSECTIONS` array in `MetadataPage.jsx`.
2. Add a corresponding `<div className={activeTab !== 'newtab' ? 'hidden' : ''}>` block.
3. To persist its internal state across refreshes, use `useLocalStorage` with an `ah_` prefixed key.

### Adding a new column to `tbl_config`
1. Add it to `MERGE_COLS` in `config.py`.
2. Add it to the `row` dict in `_save_sync` with its value or `""`.
3. Update `TableConfig` Pydantic model if the user should provide it.
4. Add it to the form in `MetadataPage.jsx` if user-editable.

### Changing the AI model
- Update `DATABRICKS_SERVING_ENDPOINT` in `backend/.env` to point to the new endpoint name.
- The endpoint must accept `{"messages": [{"role": "user", "content": "..."}], "max_tokens": N}` and return `{"choices": [{"message": {"content": "..."}}]}`.

### Modifying the log check queries
- All SQL is in `_check_logs_sync()` in `jobs.py`.
- Task errors: modify the WHERE clause on `tbl_task_run_log`.
- QC failures: modify the WHERE clause on `tbl_qc_result` (currently `qc_result != 'SUCCEEDED'` only — the `failure_message IS NOT NULL` OR was intentionally removed to avoid false positives).

### Constraints a new developer must follow
- **Never call Databricks SQL synchronously from an async FastAPI handler** — always use `asyncio.to_thread`.
- **Never use `.lower()` in `normalize_element_name`** (dictionary) or `normalize_column_name` — case preservation is intentional.
- **Always use `_idx` for row identity in filtered tables** — never use array index directly.
- **ConfigSummary state must go into the `ah_cs` localStorage key** (or add a new key with `ah_` prefix) so it survives refresh.
- **Keep both MetadataPage tab sections always mounted** — removing the `hidden` pattern will break state preservation.
- **Source files should never be committed** — `backend/files/` is gitignored for a reason.
- **Never add Marketplace tables to the whitelist without a human-readable `description`** — the AI's table selection quality depends on it.
- **Always sanitize SQL strings with `_esc()` in genie.py** — the inline SQL is not parameterized (Databricks connector limitation).
- **Never add Marketplace tables to the whitelist without a `description`** — the AI's table-selection quality depends on it.
- **narrative_json must be stored at save time** — do not regenerate the narrative on load; use the stored JSON from `tbl_genie_saved`.

---

## Quick Mental Model

- **The app is a smart form** on top of a Databricks medallion pipeline — it fills in `tbl_config` correctly and then pulls the trigger.
- **The backend is a thin proxy** — it does pandas/openpyxl work locally, then delegates everything else to Databricks (SQL, Files API, Jobs API, Model Serving) .
- **All blocking I/O uses `asyncio.to_thread`** — this is the single most important pattern to remember when adding backend features.
- **The UI is a sequential state machine** — each card in `ConfigSummary` only appears when the previous phase succeeds. Don't break the `uploadPhase → jobPhase → log1Phase → job2Phase → log2Phase` chain.
- **`config.job_name`** is the universal primary key — it links `tbl_config`, the job's `job_parameters`, the log tables, and the ConfigSummary localStorage namespace.
- **CSS is driven by CSS custom properties** (`--brand-500`, `--dark-900`, `--ui`) that flip between light/dark via the `.dark` class on `<html>`. Never hardcode color hex values in components.
- **State lives in three places:** React `useState` (ephemeral per session), `useLocalStorage` (persisted across refresh), and Databricks Delta tables (permanent backend truth).
- **The always-mounted `MetadataPage`** pattern is load-bearing. If someone adds `AnimatePresence mode="wait"` around the route or conditionally unmounts the page, live polling and form state will be destroyed on navigation.
- **The Dictionary and Dataset sections are completely independent** — they share no state, only the column-name normalization algorithm (duplicated by design for isolation).
- **Adding a new job phase** (e.g., job_30_gold) means: new constant in `jobs.py` → new endpoint → new API fn in `api.js` → new state vars + card in `ConfigSummary.jsx` + new log check entry in `_check_logs_sync`.
- **Extending Marketplace charts** means: add a new widget type in `_build_widgets()` in `genie.py` → add a React component in `components/genie/` → wire it in `DashboardView.jsx`.
- **The Marketplace module is fully self-contained** — backend in `genie.py`, frontend in `components/genie/` + `hooks/useGenieQuery.js` + `hooks/useGenieState.js`. It has its own API client (native `fetch`), its own state, and its own chart rendering. It does not interact with any metadata/dictionary state. The only shared layer is the backend `.env` credentials and the Tailwind design system.
- **The Job Run module** (`/jobrun` route, `JobRunPage.jsx` + `jobrun.py`) is separate from the single-entity job flow in `ConfigSummary`. It handles bulk multi-entity selection, sets all `active` flags in one transaction, and provides a dedicated monitor view with per-entity status cards and live task log streaming.
- **All AI in the project now routes through Databricks Model Serving** — there is no longer a direct Anthropic API dependency in active code. The endpoint must be OpenAI-compatible (chat completions format).
