"""
genie.py — AI Genie: natural-language → SQL → dashboard

Pipeline:
  Phase 0  Suitability check  — fast LLM call to decide if question is data-answerable
  Phase 1  Schema grounding   — SHOW TABLES in whitelisted schemas + DESCRIBE matched tables (TTL-cached)
  Phase 2  Text-to-SQL        — LLM generates SELECT, executor retries with self-correction (≤3×)
  Phase 3  Chart engine       — deterministic layout: 4 KPI cards + optional chart + full table
  Phase 4  Narrative + lineage — LLM summary/insights; SQL parsed for lineage metadata

All blocking I/O runs inside asyncio.to_thread (never called directly from async handlers).
"""

import os
import re
import json
import math
import time
import uuid
import hashlib
import asyncio
import requests
import pandas as pd
from pathlib import Path
from datetime import datetime
from fastapi import APIRouter, HTTPException, Depends
from auth import get_user_token, current_token, sql_token
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

# Marketplace is disabled pending a redesign of table-level access control.
# _get_accessible_tables_sync() used to scope whitelisted tables to the calling
# user's own Unity Catalog grants via their forwarded OBO token; now that every
# backend call runs as the app's service principal, that per-user check would
# silently grant every user whatever the service principal can see. Gate the
# whole router shut (rather than just hiding the frontend) so the endpoints
# can't be reached directly either. Flip MARKETPLACE_ENABLED=true once a
# replacement access-control mechanism is in place.
MARKETPLACE_ENABLED = os.getenv("MARKETPLACE_ENABLED", "false").lower() == "true"


def _require_marketplace_enabled():
    if not MARKETPLACE_ENABLED:
        raise HTTPException(
            503,
            "Marketplace is temporarily unavailable — under development.",
        )


router = APIRouter(dependencies=[Depends(_require_marketplace_enabled)])

# ── Config ────────────────────────────────────────────────────────────────────
WHITELIST_PATH    = Path(__file__).parent.parent / "marketplace_whitelist.json"
MAX_RETRIES       = 3
_SCHEMA_TTL       = 600   # 10 min — DESCRIBE TABLE cache
_TABLE_LIST_TTL   = 1800  # 30 min — SHOW TABLES cache
_CATALOG_CACHE_TTL = 300  # 5 min — Unity Catalog access check cache per user token

# In-memory caches
_schema_cache:     dict = {}  # key: "catalog.schema.table" → {columns, cached_at}
_table_list_cache: dict = {}  # key: "catalog.schema"       → {tables,  cached_at}
_catalog_cache:    dict = {}  # key: sha256(token)[:16]     → (accessible_catalogs, cached_at)


# ── Whitelist / Databricks helpers ────────────────────────────────────────────

def _load_whitelist() -> list[dict]:
    with open(WHITELIST_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def _get_accessible_tables_sync(token: str, whitelist: list[dict]) -> set[str] | None:
    """Return fq_names the user has effective SELECT on.

    Strategy:
    1. SCIM /Me (user token, SCIM scope always present) → resolve username + group names
    2. SHOW GRANTS ON TABLE/SCHEMA/CATALOG via SP SQL (SP has MANAGE on whitelist schemas,
       granted once via `GRANT MANAGE ON SCHEMA <s> TO <sp>`) → see ALL principals' grants
    3. Cross-reference: if any of user's principals appear with SELECT or ALL PRIVILEGES → accessible

    Checks all three levels so inherited schema-level or catalog-level grants are honoured.
    Results cached per token for 5 minutes.
    Returns None for local dev (token == M2M SP token) → unrestricted.
    """
    if token == os.getenv("DATABRICKS_TOKEN", ""):
        return None  # local dev → unrestricted

    key = hashlib.sha256(token.encode()).hexdigest()[:16]
    now = time.time()
    if key in _catalog_cache:
        accessible, cached_at = _catalog_cache[key]
        if now - cached_at < _CATALOG_CACHE_TTL:
            return accessible

    # Step 1: resolve user's principals via SCIM (user token always has SCIM scope)
    host = os.getenv("DATABRICKS_HOST", "").rstrip("/")
    principals: set[str] = set()
    try:
        r = requests.get(
            f"{host}/api/2.0/preview/scim/v2/Me",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
        if r.ok:
            data = r.json()
            if data.get("userName"):
                principals.add(data["userName"])
            for g in data.get("groups", []):
                name = g.get("display", "")
                if name:
                    principals.add(name)
    except Exception:
        pass

    if not principals:
        _catalog_cache[key] = (set(), now)
        return set()

    READ_PRIVILEGES = {"SELECT", "ALL PRIVILEGES"}

    # Step 2 & 3: SHOW GRANTS at table/schema/catalog level via SP SQL connection.
    # SP must have MANAGE on the whitelist schemas to see all principals' grants.
    accessible: set[str] = set()
    conn   = _get_sql_conn()
    cursor = conn.cursor()
    grants_memo: dict[str, list[tuple[str, str]]] = {}

    def _show_grants(obj_type: str, obj_name: str) -> list[tuple[str, str]]:
        memo_key = f"{obj_type}:{obj_name}"
        if memo_key in grants_memo:
            return grants_memo[memo_key]
        try:
            parts   = obj_name.split(".")
            escaped = ".".join(f"`{p}`" for p in parts)
            cursor.execute(f"SHOW GRANTS ON {obj_type} {escaped}")
            rows  = cursor.fetchall()
            desc  = [d[0].lower() for d in cursor.description]
            # Columns: Principal, ActionType, ObjectType, ObjectKey
            prin_idx = next((i for i, c in enumerate(desc) if "principal" in c), None)
            priv_idx = next((i for i, c in enumerate(desc) if "action" in c or "privilege" in c), None)
            if prin_idx is None or priv_idx is None:
                result: list[tuple[str, str]] = []
            else:
                result = [(str(row[prin_idx]), str(row[priv_idx]).upper()) for row in rows]
        except Exception:
            result = []
        grants_memo[memo_key] = result
        return result

    try:
        for entry in whitelist:
            catalog = entry["catalog"]
            schema  = entry["schema"]
            table   = entry["table"]
            fq      = f"{catalog}.{schema}.{table}"

            for obj_type, obj_name in [
                ("TABLE",   fq),
                ("SCHEMA",  f"{catalog}.{schema}"),
                ("CATALOG", catalog),
            ]:
                for principal, privilege in _show_grants(obj_type, obj_name):
                    if principal in principals and privilege in READ_PRIVILEGES:
                        accessible.add(fq)
                        break
                if fq in accessible:
                    break
    finally:
        cursor.close()
        conn.close()

    _catalog_cache[key] = (accessible, now)
    return accessible


def _filter_tables_by_access(tables: list[dict], accessible: set[str] | None) -> list[dict]:
    """Keep only tables the user has SELECT on (per Unity Catalog table-level API).

    None means unrestricted (local dev).
    Databricks already decided what's in accessible — no policy logic here.
    """
    if accessible is None:
        return tables
    return [t for t in tables if t.get("fq_name", "") in accessible]


def _get_sql_conn():
    from databricks import sql as dbsql
    host      = os.getenv("DATABRICKS_HOST", "").replace("https://", "").replace("http://", "").rstrip("/")
    http_path = os.getenv("DATABRICKS_HTTP_PATH", "")
    token     = sql_token()
    if not all([host, http_path, token]):
        raise HTTPException(500, "Databricks SQL connection vars missing")
    return dbsql.connect(server_hostname=host, http_path=http_path, access_token=token)


# ── LLM helper ────────────────────────────────────────────────────────────────

def _call_llm_sync(prompt: str, max_tokens: int = 600) -> str:
    host     = os.getenv("DATABRICKS_HOST", "").rstrip("/")
    token    = current_token()
    endpoint = os.getenv("DATABRICKS_SERVING_ENDPOINT", "")
    if not all([host, token, endpoint]):
        raise HTTPException(500, "DATABRICKS_HOST / DATABRICKS_TOKEN / DATABRICKS_SERVING_ENDPOINT missing")
    resp = requests.post(
        f"{host}/serving-endpoints/{endpoint}/invocations",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={"messages": [{"role": "user", "content": prompt}], "max_tokens": max_tokens},
        timeout=60,
    )
    if resp.status_code != 200:
        raise HTTPException(500, f"LLM call failed ({resp.status_code}): {resp.text}")
    return resp.json()["choices"][0]["message"]["content"].strip()


# ── Phase 0: Suitability check ────────────────────────────────────────────────

def _check_suitability_sync(question: str) -> dict:
    """
    Fast LLM call (~80 tokens) to decide if the question is answerable as a data dashboard.
    Returns {suitable: bool, message: str}. Fails open (returns suitable=True) on any error.
    """
    prompt = (
        "You are a data query classifier.\n"
        "Decide if the user's question can be answered by running a SQL query on a business database.\n"
        "Data questions ask about counts, totals, trends, distributions, comparisons, or specific records.\n"
        "Non-data questions include: greetings, general knowledge, coding help, opinions, or math without data.\n\n"
        f"Question: {question}\n\n"
        "Respond with ONLY JSON (no markdown):\n"
        '{"suitable": true, "message": ""}\n'
        "or\n"
        '{"suitable": false, "message": "One sentence explaining why this cannot be a dashboard"}\n\n'
        "JSON:"
    )
    try:
        raw = _call_llm_sync(prompt, max_tokens=80)
        m   = re.search(r'\{[\s\S]*\}', raw)
        if m:
            parsed = json.loads(m.group(0))
            return {
                "suitable": bool(parsed.get("suitable", True)),
                "message":  str(parsed.get("message", "")),
            }
    except Exception:
        pass
    return {"suitable": True, "message": ""}


# ── Phase 0b: Filter extraction ───────────────────────────────────────────────

def _extract_filters_sync(question: str) -> dict:
    """
    Fast LLM call (~150 tokens) to extract explicit constraints the user stated.
    Returns {filters: [{column, operator, value, label}], time_range: {start, end}|null}.
    Fails open — returns empty filters on any error.
    """
    prompt = (
        "Extract ONLY the explicit filters or constraints a user stated in this data question.\n"
        "Return ONLY JSON (no markdown), exactly this shape:\n"
        '{"filters": [{"column": "col_name", "operator": "=", "value": "2024", "label": "Year: 2024"}], '
        '"time_range": {"start": "2024-01-01", "end": "2024-12-31"}}\n\n'
        "Rules:\n"
        "- Only extract EXPLICIT constraints (specific dates, values, status words)\n"
        "- If no explicit filters, return: {\"filters\": [], \"time_range\": null}\n"
        "- Valid operators: =, >, <, >=, <=, LIKE, IN\n"
        "- time_range only when a date window is clearly stated; otherwise null\n"
        "- Labels must be human-readable (e.g. 'Status: Active', 'Year: 2024')\n\n"
        f"Question: {question}\n\nJSON:"
    )
    try:
        raw = _call_llm_sync(prompt, max_tokens=150)
        m   = re.search(r'\{[\s\S]*\}', raw)
        if m:
            parsed = json.loads(m.group(0))
            clean_filters = [
                {
                    "column":   str(f.get("column", "")),
                    "operator": str(f.get("operator", "=")),
                    "value":    str(f.get("value", "")),
                    "label":    str(f.get("label") or f"{f.get('column', '')}: {f.get('value', '')}"),
                }
                for f in parsed.get("filters", [])
                if f.get("column") and f.get("value") is not None
            ]
            return {"filters": clean_filters, "time_range": parsed.get("time_range")}
    except Exception:
        pass
    return {"filters": [], "time_range": None}


# ── Phase 1: Dynamic table discovery ─────────────────────────────────────────

def _show_tables_in_schema_sync(catalog: str, schema: str) -> list[dict]:
    """
    Run SHOW TABLES IN catalog.schema.
    Returns [{catalog, schema, table}] for all non-temporary tables. Returns [] on error.
    """
    conn   = _get_sql_conn()
    cursor = conn.cursor()
    try:
        cursor.execute(f"SHOW TABLES IN `{catalog}`.`{schema}`")
        rows      = cursor.fetchall()
        desc      = cursor.description or []
        col_names = [d[0].lower() for d in desc]
        result    = []
        for row in rows:
            rec  = dict(zip(col_names, row))
            # Databricks SHOW TABLES returns: namespace, tableName, isTemporary
            name = (
                rec.get("tablename")
                or rec.get("table_name")
                or rec.get("name")
                or (str(row[1]) if len(row) > 1 else None)
            )
            is_tmp = rec.get("istemporary") or rec.get("is_temporary") or False
            if name and not is_tmp:
                result.append({"catalog": catalog, "schema": schema, "table": str(name)})
        return result
    except Exception:
        return []
    finally:
        cursor.close()
        conn.close()


def _list_all_tables_sync() -> list[dict]:
    """
    Discover all non-temporary tables in catalog+schema pairs from the whitelist.
    Merges whitelist description/domain metadata where available.
    Cached per catalog.schema for 30 minutes.
    Falls back to whitelist-only entries (with DESCRIBE) if SHOW TABLES fails for all schemas.
    """
    whitelist = _load_whitelist()
    wl_lookup = {f"{e['catalog']}.{e['schema']}.{e['table']}": e for e in whitelist}
    schemas   = list({(e["catalog"], e["schema"]) for e in whitelist})
    now       = time.time()
    all_entries: list[dict] = []

    for catalog, schema in schemas:
        cache_key = f"{catalog}.{schema}"
        cached    = _table_list_cache.get(cache_key)
        if cached and (now - cached["cached_at"]) < _TABLE_LIST_TTL:
            tables = cached["tables"]
        else:
            tables = _show_tables_in_schema_sync(catalog, schema)
            _table_list_cache[cache_key] = {"tables": tables, "cached_at": now}

        for t in tables:
            fq  = f"{t['catalog']}.{t['schema']}.{t['table']}"
            wl  = wl_lookup.get(fq, {})
            all_entries.append({
                "catalog":     t["catalog"],
                "schema":      t["schema"],
                "table":       t["table"],
                "fq_name":     fq,
                "description": wl.get("description", ""),
                "domain":      wl.get("domain", ""),
                "columns":     [],  # filled on-demand by _describe_with_cache
            })

    if not all_entries:
        # Fallback: use whitelist entries directly with full DESCRIBE
        return _get_all_schemas_sync()

    return all_entries


def _describe_table_sync(catalog: str, schema: str, table: str) -> list[dict]:
    """Run DESCRIBE TABLE and return [{name, type}]. Stops at partition headers. Returns [] on error."""
    fq     = f"`{catalog}`.`{schema}`.`{table}`"
    conn   = _get_sql_conn()
    cursor = conn.cursor()
    try:
        cursor.execute(f"DESCRIBE TABLE {fq}")
        cols = []
        for row in cursor.fetchall():
            col_name = row[0] if row[0] else ""
            if col_name.startswith("#") or not col_name.strip():
                break
            cols.append({
                "name": col_name.strip(),
                "type": str(row[1]).strip() if len(row) > 1 else "STRING",
            })
        return cols
    except Exception:
        return []
    finally:
        cursor.close()
        conn.close()


def _describe_with_cache(entry: dict) -> dict:
    """DESCRIBE TABLE for an entry using TTL cache. Returns a new dict with 'columns' filled."""
    now    = time.time()
    key    = entry["fq_name"]
    cached = _schema_cache.get(key)
    if cached and (now - cached["cached_at"]) < _SCHEMA_TTL:
        return {**entry, "columns": cached["columns"]}
    cols = _describe_table_sync(entry["catalog"], entry["schema"], entry["table"])
    _schema_cache[key] = {"columns": cols, "cached_at": now}
    return {**entry, "columns": cols}


def _get_all_schemas_sync() -> list[dict]:
    """Fallback: load whitelist + DESCRIBE each entry (TTL-cached)."""
    whitelist = _load_whitelist()
    now       = time.time()
    enriched  = []
    for entry in whitelist:
        catalog = entry["catalog"]
        schema  = entry["schema"]
        table   = entry["table"]
        key     = f"{catalog}.{schema}.{table}"
        cached  = _schema_cache.get(key)
        if cached and (now - cached["cached_at"]) < _SCHEMA_TTL:
            columns = cached["columns"]
        else:
            columns = _describe_table_sync(catalog, schema, table)
            _schema_cache[key] = {"columns": columns, "cached_at": now}
        enriched.append({**entry, "fq_name": key, "columns": columns})
    return enriched


def _match_schemas(question: str, all_schemas: list[dict]) -> list[dict]:
    """
    Score each table by keyword overlap with the question.
    Returns tables with score > 0 sorted descending by score (capped at 20).
    Falls back to first 10 tables if nothing scores.
    """
    tokens = set(re.findall(r'\w+', question.lower()))
    scored = []
    for entry in all_schemas:
        score = 0
        for tok in re.findall(r'\w+', entry["table"].lower()):
            score += 3 * int(tok in tokens)
        for col in entry.get("columns", []):
            for tok in re.findall(r'\w+', col["name"].lower()):
                if tok not in {"id", "key", "code", "flag", "type"} and tok in tokens:
                    score += 2
        desc_tokens = set(re.findall(r'\w+', entry.get("description", "").lower()))
        score += len(tokens & desc_tokens)
        domain_tokens = set(re.findall(r'\w+', entry.get("domain", "").lower()))
        score += 2 * len(tokens & domain_tokens)
        scored.append((score, entry))

    scored.sort(key=lambda x: x[0], reverse=True)
    matched = [e for s, e in scored if s > 0]
    return matched[:20] if matched else [e for _, e in scored[:10]]


def _format_schema_context(schemas: list[dict]) -> str:
    parts = []
    for s in schemas:
        fq       = s["fq_name"]
        desc     = s.get("description", "")
        dom      = s.get("domain", "")
        cols     = s.get("columns", [])
        col_lines = "\n".join(f"  - {c['name']} ({c['type']})" for c in cols) if cols else "  (no column info available)"
        parts.append(f"Table: {fq}\nDomain: {dom}\nPurpose: {desc}\nColumns:\n{col_lines}")
    return "\n\n".join(parts)


# ── Phase 2: Text-to-SQL with self-correction ─────────────────────────────────

_BLOCKED_SQL = re.compile(
    r'\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|EXEC(?:UTE)?|GRANT|REVOKE|MERGE)\b',
    re.IGNORECASE,
)


def _check_balanced_parens(sql: str) -> None:
    """Raise ValueError if parentheses are unbalanced — indicates a truncated LLM response."""
    depth, in_str = 0, False
    for ch in sql:
        if ch == "'" and not in_str:
            in_str = True
        elif ch == "'" and in_str:
            in_str = False
        elif not in_str:
            if ch == '(':
                depth += 1
            elif ch == ')':
                depth -= 1
    if depth != 0:
        raise ValueError(
            f"SQL response was truncated (unbalanced parentheses: depth={depth}). "
            "Retrying with a simpler query."
        )


def _extract_and_validate_sql(raw: str) -> str:
    """Strip code fences, enforce SELECT-only, check for truncation, append LIMIT if absent."""
    sql   = re.sub(r'```sql\s*', '', raw, flags=re.IGNORECASE)
    sql   = re.sub(r'```\s*', '', sql).strip().rstrip(';')
    upper = sql.lstrip().upper()
    if not (upper.startswith('SELECT') or upper.startswith('WITH')):
        raise ValueError("LLM output is not a SELECT statement")
    if _BLOCKED_SQL.search(sql):
        raise ValueError("SQL contains prohibited DML/DDL keyword")
    _check_balanced_parens(sql)
    if 'LIMIT' not in sql.upper():
        sql += '\nLIMIT 1000'
    return sql


def _generate_sql_sync(question: str, schema_ctx: str, filter_hints: str = "") -> str:
    filter_line = (
        f"ACTIVE FILTERS (must be reflected in WHERE clause): {filter_hints}\n\n"
        if filter_hints else ""
    )
    prompt = (
        "You are a Databricks SQL expert.\n"
        "Generate ONE read-only SELECT query that answers the question below.\n\n"
        f"AVAILABLE TABLES:\n{schema_ctx}\n\n"
        f"QUESTION: {question}\n\n"
        f"{filter_line}"
        "RULES:\n"
        "1. Output ONLY the SQL — no markdown, no code fences, no explanation\n"
        "2. Only SELECT statements (no INSERT/UPDATE/DELETE/DROP/CREATE/ALTER)\n"
        "3. Use the exact fully-qualified table names shown above (catalog.schema.table)\n"
        "4. Only reference columns listed above — do not invent column names\n"
        "5. PRIORITIZE aggregation: use GROUP BY with COUNT(*), SUM(), AVG(), MAX(), or MIN() "
        "whenever the question asks about counts, totals, distributions, comparisons, or trends\n"
        "6. Add LIMIT 1000 if the result could be large\n"
        "7. Use Databricks SQL syntax (date_trunc, dateadd, INTERVAL, try_cast, etc.)\n"
        "8. Keep the SELECT list minimal — only columns needed to answer the question\n"
        "9. Avoid computing many derived columns; prefer simple aggregations\n"
        "10. Do NOT use aliases that shadow reserved words\n"
        "11. If the question cannot be answered with available tables, write: "
        "SELECT 'Unable to answer this question with available data' AS message\n\n"
        "SQL:"
    )
    return _extract_and_validate_sql(_call_llm_sync(prompt, max_tokens=1500))


def _fix_sql_sync(sql: str, error: str, schema_ctx: str) -> str:
    truncated     = "truncated" in error.lower() or "unbalanced" in error.lower()
    simplify_hint = (
        "\nIMPORTANT: The previous query was too long and got cut off. "
        "Write a much shorter, simpler query — fewer columns, no complex derived fields.\n"
        if truncated else ""
    )
    prompt = (
        "A Databricks SQL query failed. Correct it.\n\n"
        f"SCHEMA:\n{schema_ctx}\n\n"
        f"BROKEN SQL:\n{sql}\n\n"
        f"ERROR:\n{error}\n"
        f"{simplify_hint}\n"
        "Return ONLY the corrected SQL — no markdown, no explanation.\n\n"
        "FIXED SQL:"
    )
    return _extract_and_validate_sql(_call_llm_sync(prompt, max_tokens=1500))


def _execute_sql_sync(sql: str) -> list:
    conn   = _get_sql_conn()
    cursor = conn.cursor()
    try:
        cursor.execute(sql)
        cols = [d[0] for d in (cursor.description or [])]
        rows = []
        for row in cursor.fetchall():
            record: dict = {}
            for k, v in zip(cols, row):
                if hasattr(v, "isoformat"):
                    record[k] = v.isoformat()
                elif v is None:
                    record[k] = None
                elif isinstance(v, (int, float, bool)):
                    record[k] = v
                else:
                    record[k] = str(v)
            rows.append(record)
        return rows
    finally:
        cursor.close()
        conn.close()


def _sql_pipeline_sync(question: str, schema_ctx: str, filter_hints: str = "") -> tuple:
    """Generate SQL, execute, auto-correct on failure. Returns (sql, rows)."""
    sql        = _generate_sql_sync(question, schema_ctx, filter_hints)
    last_error = ""
    for attempt in range(MAX_RETRIES):
        try:
            rows = _execute_sql_sync(sql)
            return sql, rows
        except HTTPException:
            raise
        except Exception as exc:
            last_error = str(exc)
            if attempt < MAX_RETRIES - 1:
                try:
                    sql = _fix_sql_sync(sql, last_error, schema_ctx)
                except Exception:
                    pass
    raise HTTPException(
        422,
        f"Could not produce a working query after {MAX_RETRIES} attempts. "
        f"Last error: {last_error}",
    )


# ── Phase 3: Deterministic chart engine ──────────────────────────────────────

_DATE_HINTS  = {"date", "time", "at", "day", "month", "year", "week", "period", "created", "updated", "start", "end"}

# Column name → ID identifier: ends with "id"/"idno" (EmployeeID, WorkdayIDNo), _key, uuid, guid
_ID_PAT      = re.compile(r'(id$|idno$|_key$|uuid|guid)', re.IGNORECASE)

# Column name → explicit quantitative measure: count, total, sum, amount, etc.
_MEASURE_PAT = re.compile(
    r'(count|total|sum|amount|revenue|qty|quantity|average|rate|pct|percent|score|salary|cost|fee|budget)',
    re.IGNORECASE,
)


def _is_date_col(col_name: str) -> bool:
    # Split on underscores and digits so "start_date" → {"start", "date"} → matches "date"
    tokens = set(re.findall(r'[a-zA-Z]+', col_name.lower()))
    return bool(tokens & _DATE_HINTS)


def _coerce_numerics(df: pd.DataFrame) -> None:
    """
    Coerce string-encoded numbers in-place (Databricks sometimes returns ints as strings).
    ID columns (matching _ID_PAT) are intentionally skipped — numeric-looking IDs such as
    "24428017" must stay as strings so they are never treated as measures.
    """
    for col in df.columns:
        if _ID_PAT.search(col):
            continue  # never coerce identifier columns
        if df[col].dtype == object:
            try:
                converted = pd.to_numeric(df[col], errors="coerce")
                if converted.notna().sum() >= len(df) * 0.8:
                    df[col] = converted
            except Exception:
                pass


def _classify_numeric_cols(df: pd.DataFrame, numeric_cols: list) -> tuple:
    """
    Split numeric columns into dimension-like (category codes) and measure-like (metrics).

    Decision priority per column:
      1. Matches _ID_PAT by name  OR  all-unique + large values → identifier dim (not a measure)
      2. Matches _MEASURE_PAT by name                           → explicit measure
      3. All-integer, small range (max ≤ max(3×nunique, 20) and ≤ 100)  → dimension code
      4. Everything else                                         → measure

    Falls back to treating all as measures if nothing reaches measure_cols.
    """
    n_rows         = len(df)
    dim_cols: list = []
    measure_cols: list = []

    for c in numeric_cols:
        col = df[c].dropna()
        if len(col) == 0:
            measure_cols.append(c)
            continue

        mx   = float(col.max())
        uniq = col.nunique()

        # ── Priority 1: identifier detection ─────────────────────────────────
        is_named_id     = bool(_ID_PAT.search(c))
        # All-unique values + large numbers → numeric primary key (e.g., WorkdayID=24428017)
        is_numeric_pk   = (uniq >= max(n_rows - 1, 1) and n_rows > 3 and mx > 100)
        if is_named_id or is_numeric_pk:
            dim_cols.append(c)  # available as last-resort x-axis, never as a measure
            continue

        # ── Priority 2: explicit measure by column name ───────────────────────
        if _MEASURE_PAT.search(c):
            measure_cols.append(c)
            continue

        # ── Priority 3: small-integer dimension code ──────────────────────────
        try:
            is_int = all(float(v) == int(float(v)) for v in col)
        except Exception:
            is_int = False
        if is_int and mx <= max(uniq * 3, 20) and mx <= 100:
            dim_cols.append(c)
        else:
            measure_cols.append(c)

    # ── Fallback: nothing reached measure_cols ────────────────────────────────
    if not measure_cols:
        non_id_dims = [c for c in dim_cols if not _ID_PAT.search(c)]
        if non_id_dims:
            measure_cols = non_id_dims
            dim_cols     = [c for c in dim_cols if _ID_PAT.search(c)]
        else:
            measure_cols = dim_cols
            dim_cols     = []

    return dim_cols, measure_cols


def _safe_num(v):
    """Convert to a JSON-safe Python number; returns 0 for NaN/Inf/None."""
    try:
        f = float(v)
        if math.isnan(f) or math.isinf(f):
            return 0
        return int(f) if f == int(f) and abs(f) < 1e15 else round(f, 4)
    except Exception:
        return 0


def _kpi(title: str, label: str, value) -> dict:
    return {
        "type":   "KPI_CARD",
        "title":  title,
        "data":   [{"label": label, "value": _safe_num(value)}],
        "x_key":  None,
        "y_keys": None,
    }


def _compute_kpis(rows: list, df: pd.DataFrame, measure_cols: list, cat_cols: list) -> list:
    """
    Return exactly 4 KPI_CARD widgets.
    measure_cols: the actual metric columns (employee_count, revenue, etc.)
    cat_cols:     string or dimension-numeric columns (used for "Unique X" KPI)
    """
    kpis: list[dict] = []
    total_rows = len(rows)

    if len(rows) == 1:
        # Single-row result: each measure column becomes its own KPI
        for col in measure_cols[:4]:
            kpis.append(_kpi(col.replace("_", " ").title(), col, rows[0].get(col)))
    elif measure_cols:
        pn = measure_cols[0]
        kpis += [
            _kpi(f"Total {pn.replace('_', ' ').title()}",   pn, df[pn].sum()),
            _kpi(f"Average {pn.replace('_', ' ').title()}", pn, df[pn].mean()),
            _kpi(f"Max {pn.replace('_', ' ').title()}",     pn, df[pn].max()),
        ]
        if cat_cols:
            pc = cat_cols[0]
            kpis.append(_kpi(f"Unique {pc.replace('_', ' ').title()}", pc, df[pc].nunique()))
        else:
            kpis.append(_kpi(f"Min {pn.replace('_', ' ').title()}", pn, df[pn].min()))

    # Pad to exactly 4 with "Total Records"
    while len(kpis) < 4:
        kpis.append(_kpi("Total Records", "count", total_rows))

    return kpis[:4]


def _detect_stacked_intent(question: str) -> tuple:
    """Return (is_stacked: bool, top_n: int|None) from question text."""
    q = question.lower()
    is_stacked = bool(re.search(r'\bstack(ed)?\b', q))
    m = re.search(r'\btop\s+(\d+)\b', q)
    top_n = int(m.group(1)) if m else None
    return is_stacked, top_n


def _build_widgets(rows: list, question: str = "") -> list:
    """Layout: 4 KPI cards → up to 3 charts (stacked + line + bar, independently) → full table."""
    if not rows:
        return [{"type": "TABLE", "title": "No Results Found", "data": [], "x_key": None, "y_keys": None}]

    df = pd.DataFrame(rows)
    _coerce_numerics(df)

    all_numeric  = [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c])]
    date_cols    = [c for c in df.columns if _is_date_col(c)]
    string_cols  = [c for c in df.columns if df[c].dtype == object and not _is_date_col(c)]

    dim_numeric, measure_cols = _classify_numeric_cols(df, all_numeric)

    non_id_strings = [c for c in string_cols if not _ID_PAT.search(c)]
    id_strings     = [c for c in string_cols if _ID_PAT.search(c)]
    x_candidates   = non_id_strings + [c for c in dim_numeric if not _ID_PAT.search(c)] + id_strings + dim_numeric
    cat_cols       = non_id_strings + dim_numeric + id_strings

    widgets: list[dict] = []
    widgets += _compute_kpis(rows, df, measure_cols, cat_cols)

    is_stacked, top_n = _detect_stacked_intent(question)
    stacked_added = False
    charts_added  = 0
    MAX_CHARTS    = 3

    # ── Stacked bar: explicit keyword OR auto-detected multi-dim data ──────────
    # Auto-detect: ≥2 non-ID categoricals where the high-cardinality one repeats
    # (i.e. programme_name × leadership_stage SQL result shape)
    non_id_cats = sorted(
        [c for c in non_id_strings + [c for c in dim_numeric if not _ID_PAT.search(c)]],
        key=lambda c: df[c].nunique(),
    )
    if measure_cols and len(non_id_cats) >= 2:
        stack_key = non_id_cats[0]   # lowest cardinality → legend (e.g. stages)
        x_key_sb  = non_id_cats[1]   # higher cardinality → x-axis (e.g. programmes)
        auto_stacked = df[x_key_sb].nunique() < len(rows)  # confirmed multi-dim result
        if (is_stacked or auto_stacked) and charts_added < MAX_CHARTS:
            measure = measure_cols[0]
            try:
                pivot = df.pivot_table(
                    index=x_key_sb, columns=stack_key,
                    values=measure, aggfunc="sum", fill_value=0,
                ).reset_index()
                pivot.columns.name = None
                stack_vals = [c for c in pivot.columns if c != x_key_sb]
                pivot["_total"] = pivot[stack_vals].sum(axis=1)
                if top_n:
                    pivot = pivot.nlargest(top_n, "_total")
                pivot = pivot.sort_values("_total", ascending=False).drop(columns=["_total"])
                stack_vals = [c for c in pivot.columns if c != x_key_sb]
                pivot = pivot.rename(columns={c: str(c) for c in stack_vals})
                stack_keys_str = [str(c) for c in stack_vals]
                stacked_data = [{str(k): v for k, v in rec.items()} for rec in pivot.to_dict("records")]
                lbl     = measure.replace("_", " ").title()
                n_label = f"Top {top_n} — " if top_n else ""
                title   = (
                    f"{n_label}{lbl} by "
                    f"{x_key_sb.replace('_', ' ').title()} "
                    f"and {stack_key.replace('_', ' ').title()}"
                )
                widgets.append({
                    "type":   "STACKED_BAR_CHART",
                    "title":  title,
                    "x_key":  x_key_sb,
                    "y_keys": stack_keys_str,
                    "data":   stacked_data,
                })
                stacked_added = True
                charts_added += 1
            except Exception:
                pass  # fall through

    # ── Time-series line chart (independent of stacked — always add when dates present) ─
    if charts_added < MAX_CHARTS and date_cols and measure_cols:
        x   = date_cols[0]
        ys  = measure_cols[:4]
        lbl = ys[0].replace("_", " ").title() if len(ys) == 1 else "Metrics"
        widgets.append({
            "type":   "LINE_CHART",
            "title":  f"{lbl} Over Time",
            "x_key":  x,
            "y_keys": ys,
            "data":   rows[:500],
        })
        charts_added += 1

    # ── Bar chart (skip when stacked already covers the same categorical dimension) ─
    if charts_added < MAX_CHARTS and x_candidates and measure_cols and not stacked_added:
        non_id     = [c for c in x_candidates if not _ID_PAT.search(c)]
        candidates = sorted(non_id or x_candidates, key=lambda c: df[c].nunique())
        for x in candidates:
            ys              = measure_cols[:3]
            lbl             = ys[0].replace("_", " ").title() if len(ys) == 1 else "Comparison"
            n_unique        = df[x].nunique()
            primary_measure = ys[0]

            if n_unique < len(rows):
                agg_ys = [y for y in ys if y in df.columns and pd.api.types.is_numeric_dtype(df[y])]
                if agg_ys:
                    agg_df     = df.groupby(x, as_index=False)[agg_ys].sum()
                    agg_df     = agg_df.sort_values(agg_ys[0], ascending=False)
                    chart_rows = agg_df.to_dict("records")
                else:
                    chart_rows = sorted(rows, key=lambda r: (r.get(primary_measure) or 0), reverse=True)
            else:
                chart_rows = sorted(rows, key=lambda r: (r.get(primary_measure) or 0), reverse=True)

            if n_unique <= 50:
                chart_data = chart_rows[:50]
                title = f"{lbl} by {x.replace('_', ' ').title()}"
            else:
                chart_data = chart_rows[:20]
                title = f"Top 20 — {lbl} by {x.replace('_', ' ').title()}"
            widgets.append({
                "type":   "BAR_CHART",
                "title":  title,
                "x_key":  x,
                "y_keys": ys,
                "data":   chart_data,
            })
            charts_added += 1
            break

    # ── Always include full data table ─────────────────────────────────────────
    widgets.append({
        "type":   "TABLE",
        "title":  "Full Results",
        "data":   rows[:500],
        "x_key":  None,
        "y_keys": None,
    })

    return widgets


# ── Phase 4: Narrative + lineage ──────────────────────────────────────────────

def _generate_narrative_sync(question: str, sql: str, rows: list) -> dict:
    """Single LLM call → {title, description, summary, insights: [...]}."""
    preview = json.dumps(rows[:5], default=str)
    prompt = (
        "You are a business intelligence assistant.\n"
        "Given the question, SQL, and sample data below, respond with ONLY a JSON object.\n\n"
        f"Question: {question}\n"
        f"SQL (first 400 chars): {sql[:400]}\n"
        f"Rows returned: {len(rows)}\n"
        f"Sample data: {preview}\n\n"
        "Respond with exactly this JSON structure (no markdown, no explanation):\n"
        '{"title": "Short dashboard title, max 8 words",\n'
        ' "description": "One sentence describing what this dashboard shows",\n'
        ' "summary": "1-2 sentences summarising the key finding. Be specific about numbers.",\n'
        ' "insights": ["Insight 1", "Insight 2", "Insight 3"]}\n\n'
        "JSON:"
    )
    try:
        raw = _call_llm_sync(prompt, max_tokens=500)
        m   = re.search(r'\{[\s\S]*\}', raw)
        if m:
            parsed = json.loads(m.group(0))
            return {
                "title":       str(parsed.get("title",       question[:60])),
                "description": str(parsed.get("description", "")),
                "summary":     str(parsed.get("summary",     f"Your query returned {len(rows)} result(s).")),
                "insights":    [str(i) for i in parsed.get("insights", [])],
            }
    except Exception:
        pass
    return {
        "title":       question[:60],
        "description": "",
        "summary":     f"Your query returned {len(rows)} result{'s' if len(rows) != 1 else ''}.",
        "insights":    [],
    }


def _tables_from_sql(sql: str) -> list[str]:
    """Extract fully-qualified table names referenced in FROM / JOIN clauses."""
    matches = re.findall(
        r'\b(?:FROM|JOIN)\s+((?:`?[\w]+`?\.)*`?[\w]+`?)',
        sql, re.IGNORECASE,
    )
    seen: set[str] = set()
    result: list[str] = []
    for m in matches:
        key = m.lower().replace("`", "")
        if key not in seen:
            seen.add(key)
            result.append(m.strip())
    return result


def _extract_lineage(sql: str, rows: list, matched_schemas: list) -> dict:
    """Programmatic SQL inspection — no LLM. Tables, columns, aggregations, GROUP BY."""
    sql_upper = sql.upper()

    tables_used: list[str] = []
    for s in matched_schemas:
        plain_fq = s["fq_name"].replace("`", "")
        if plain_fq.upper() in sql_upper:
            tables_used.append(s["fq_name"])

    result_columns = list(rows[0].keys()) if rows else []

    agg_found = {
        m.group(1).upper()
        for m in re.finditer(
            r'\b(SUM|COUNT|AVG|MAX|MIN|MEDIAN|STDDEV|VARIANCE|COLLECT_LIST|COLLECT_SET)\s*\(',
            sql, re.IGNORECASE,
        )
    }

    group_by: list[str] = []
    gb_match = re.search(
        r'\bGROUP\s+BY\s+([\s\S]+?)(?:\bHAVING\b|\bORDER\b|\bLIMIT\b|$)',
        sql, re.IGNORECASE,
    )
    if gb_match:
        raw_gb   = gb_match.group(1).strip()
        group_by = [
            re.sub(r'\s.*', '', c.strip().split('.')[-1])
            for c in raw_gb.split(',')
            if c.strip()
        ][:6]

    has_joins = bool(re.search(r'\bJOIN\b', sql, re.IGNORECASE))

    transformations: list[str] = []
    if agg_found:
        transformations.append(f"Aggregations: {', '.join(sorted(agg_found))}")
    if group_by:
        transformations.append(f"Grouped by: {', '.join(group_by)}")
    if has_joins:
        transformations.append("Multi-table join")
    if re.search(r'\bWHERE\b', sql, re.IGNORECASE):
        transformations.append("Filtered (WHERE clause)")
    if re.search(r'\bORDER\s+BY\b', sql, re.IGNORECASE):
        transformations.append("Sorted (ORDER BY)")

    return {
        "tables_used":     tables_used,
        "result_columns":  result_columns,
        "transformations": transformations,
        "row_count":       len(rows),
        "has_joins":       has_joins,
    }


# ── Saved Dashboards ──────────────────────────────────────────────────────────

_GENIE_SAVED_TABLE = "catalog_cross_ncss.gold.tbl_genie_saved"


def _esc(s: str) -> str:
    """Escape single quotes for safe SQL string-literal embedding."""
    return str(s).replace("'", "''")


def _safe_genie_view_name(title: str) -> str:
    slug = re.sub(r'[^a-z0-9]+', '_', title.lower()).strip('_')[:48]
    return f"vw_genie_{slug or 'dashboard'}"


def _ensure_genie_saved_table_sync() -> None:
    conn   = _get_sql_conn()
    cursor = conn.cursor()
    try:
        cursor.execute(f"""
            CREATE TABLE IF NOT EXISTS {_GENIE_SAVED_TABLE} (
                id             STRING,
                title          STRING,
                description    STRING,
                question       STRING,
                sql_used       STRING,
                view_name      STRING,
                created_at     STRING,
                narrative_json STRING
            ) USING DELTA
        """)
    except Exception:
        pass
    # Add narrative_json to existing tables (no-op if already present)
    try:
        cursor.execute(f"ALTER TABLE {_GENIE_SAVED_TABLE} ADD COLUMN narrative_json STRING")
    except Exception:
        pass
    finally:
        cursor.close()
        conn.close()


def _create_genie_view_sync(view_name: str, sql_used: str) -> None:
    # Strip LIMIT before creating view so it returns all rows
    view_sql = re.sub(r'\s*LIMIT\s+\d+\s*$', '', sql_used.strip(), flags=re.IGNORECASE)
    fq = f"`catalog_cross_ncss`.`gold`.`{view_name}`"
    conn   = _get_sql_conn()
    cursor = conn.cursor()
    try:
        cursor.execute(f"CREATE OR REPLACE VIEW {fq} AS {view_sql}")
    finally:
        cursor.close()
        conn.close()


def _save_genie_dashboard_sync(
    title: str, description: str, question: str, sql_used: str,
    narrative_json: dict | None = None,
) -> dict:
    _ensure_genie_saved_table_sync()
    dashboard_id   = uuid.uuid4().hex[:8]
    view_name      = _safe_genie_view_name(title)
    created_at     = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S")
    narrative_str  = json.dumps(narrative_json or {})

    _create_genie_view_sync(view_name, sql_used)

    conn   = _get_sql_conn()
    cursor = conn.cursor()
    try:
        cursor.execute(f"""
            INSERT INTO {_GENIE_SAVED_TABLE}
            (id, title, description, question, sql_used, view_name, created_at, narrative_json)
            VALUES (
                '{dashboard_id}',
                '{_esc(title)}',
                '{_esc(description)}',
                '{_esc(question)}',
                '{_esc(sql_used)}',
                '{view_name}',
                '{created_at}',
                '{_esc(narrative_str)}'
            )
        """)
    finally:
        cursor.close()
        conn.close()

    return {"id": dashboard_id, "view_name": view_name, "created_at": created_at}


def _list_genie_saved_sync() -> list:
    try:
        _ensure_genie_saved_table_sync()
        conn   = _get_sql_conn()
        cursor = conn.cursor()
        try:
            cursor.execute(f"""
                SELECT id, title, description, view_name, created_at
                FROM   {_GENIE_SAVED_TABLE}
                ORDER BY created_at DESC
                LIMIT 20
            """)
            cols = [d[0] for d in (cursor.description or [])]
            return [dict(zip(cols, row)) for row in cursor.fetchall()]
        finally:
            cursor.close()
            conn.close()
    except Exception:
        return []


def _run_saved_sync(dashboard_id: str) -> dict:
    """Fetch stored SQL by id, re-execute query, rebuild widgets. Uses stored narrative — no LLM call."""
    conn   = _get_sql_conn()
    cursor = conn.cursor()
    try:
        cursor.execute(f"""
            SELECT question, sql_used, title, narrative_json
            FROM   {_GENIE_SAVED_TABLE}
            WHERE  id = '{_esc(dashboard_id)}'
            LIMIT 1
        """)
        cols = [d[0] for d in (cursor.description or [])]
        row  = cursor.fetchone()
        if not row:
            raise HTTPException(404, f"Saved dashboard '{dashboard_id}' not found")
        rec = dict(zip(cols, row))
    finally:
        cursor.close()
        conn.close()

    question       = str(rec.get("question") or "")
    sql_used       = str(rec.get("sql_used") or "")
    narrative_raw  = rec.get("narrative_json") or "{}"

    # Parse stored narrative; fall back to LLM only if the record pre-dates this feature
    try:
        narrative = json.loads(narrative_raw) if narrative_raw else {}
    except Exception:
        narrative = {}

    if not narrative.get("title"):
        narrative = _generate_narrative_sync(question, sql_used, [])

    rows    = _execute_sql_sync(sql_used)
    widgets = _build_widgets(rows, question)
    # Reconstruct matched_schemas from the SQL so tables_used is populated
    sql_tables = [{"fq_name": t} for t in _tables_from_sql(sql_used)]
    lineage = _extract_lineage(sql_used, rows, sql_tables)

    return {
        "suitable":              True,
        "dashboard_title":       narrative.get("title", rec.get("title", "")),
        "dashboard_description": narrative.get("description", ""),
        "speech_bubble_summary": narrative.get("summary", ""),
        "key_insights":          narrative.get("insights", []),
        "lineage":               lineage,
        "sql_used":              sql_used,
        "layout":                {"widgets": widgets},
        "filters_extracted":     [],
        "time_range":            None,
        "parameters":            [],
    }


def _delete_genie_dashboard_sync(dashboard_id: str) -> None:
    conn   = _get_sql_conn()
    cursor = conn.cursor()
    try:
        cursor.execute(f"""
            DELETE FROM {_GENIE_SAVED_TABLE}
            WHERE id = '{_esc(dashboard_id)}'
        """)
    finally:
        cursor.close()
        conn.close()


# ── Pydantic models ───────────────────────────────────────────────────────────

class GenieRequest(BaseModel):
    question:       str
    active_filters: list[dict] = []
    pinned_tables:  list[str]  = []   # fq_names the user has selected; empty = use all


class GenieSaveRequest(BaseModel):
    title:          str
    description:    str  = ""
    question:       str  = ""
    sql_used:       str
    narrative_json: dict = {}


class GenieRunSavedRequest(BaseModel):
    id: str


# ── Full pipeline (sync — runs inside asyncio.to_thread) ─────────────────────

def _genie_sync(question: str, pinned_tables: list[str] | None = None, accessible_tables: set | None = None) -> dict:
    # Phase 0: decide if the question is data-answerable
    suitability = _check_suitability_sync(question)
    if not suitability["suitable"]:
        return {
            "suitable": False,
            "message":  suitability["message"] or "This question doesn't appear to be answerable as a data dashboard.",
        }

    # Phase 0b: extract explicit filters from the question (~150 tokens)
    extracted   = _extract_filters_sync(question)
    filters     = extracted["filters"]
    time_range  = extracted.get("time_range")

    # Build a compact filter hint string for the SQL prompt
    filter_parts: list[str] = []
    for f in filters:
        filter_parts.append(f"{f['column']} {f['operator']} {f['value']!r}")
    if time_range and isinstance(time_range, dict):
        start = time_range.get("start", "")
        end   = time_range.get("end", "")
        if start or end:
            filter_parts.append(f"date range {start} to {end}")
    filter_hints = "; ".join(filter_parts)

    # Phase 1: discover tables — restrict to tables user has SELECT on (table-level check),
    # then apply pinned selection
    all_tables = _filter_tables_by_access(_list_all_tables_sync(), accessible_tables)
    if pinned_tables:
        valid_fqs  = {t["fq_name"] for t in all_tables}
        pinned_set = {p for p in pinned_tables if p in valid_fqs}  # strip inaccessible pins
        pool = [t for t in all_tables if t["fq_name"] in pinned_set]
        if not pool:
            pool = all_tables
    else:
        pool = all_tables

    matched   = _match_schemas(question, pool)
    # DESCRIBE only the top candidates (≤6) to limit Databricks round-trips
    top_match  = matched[:6]
    described  = [_describe_with_cache(t) for t in top_match]
    schema_ctx = _format_schema_context(described)

    # Phase 2: generate + execute SQL (with extracted filter hints)
    sql, rows  = _sql_pipeline_sync(question, schema_ctx, filter_hints)

    # Phase 3: fixed-layout widgets (4 KPIs + optional chart + table)
    widgets    = _build_widgets(rows, question)

    # Phase 4: narrative + lineage
    narrative  = _generate_narrative_sync(question, sql, rows)
    lineage    = _extract_lineage(sql, rows, described)

    return {
        "suitable":              True,
        "dashboard_title":       narrative["title"],
        "dashboard_description": narrative["description"],
        "speech_bubble_summary": narrative["summary"],
        "key_insights":          narrative["insights"],
        "lineage":               lineage,
        "sql_used":              sql,
        "layout":                {"widgets": widgets},
        "filters_extracted":     filters,
        "time_range":            time_range,
        "parameters":            [],
    }


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/genie/ask")
async def genie_ask(req: GenieRequest, _: str = Depends(get_user_token)):
    if not req.question.strip():
        raise HTTPException(400, "Question cannot be empty")
    token           = current_token()
    whitelist       = _load_whitelist()
    accessible      = await asyncio.to_thread(_get_accessible_tables_sync, token, whitelist)
    try:
        return await asyncio.to_thread(
            _genie_sync, req.question.strip(), req.pinned_tables or None, accessible
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


@router.post("/genie/save")
async def genie_save(req: GenieSaveRequest, _: str = Depends(get_user_token)):
    if not req.sql_used.strip():
        raise HTTPException(400, "sql_used is required")
    if not req.title.strip():
        raise HTTPException(400, "title is required")
    try:
        return await asyncio.to_thread(
            _save_genie_dashboard_sync,
            req.title.strip(), req.description, req.question, req.sql_used,
            req.narrative_json,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


@router.get("/genie/saved")
async def genie_saved_list(_: str = Depends(get_user_token)):
    try:
        return await asyncio.to_thread(_list_genie_saved_sync)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


@router.post("/genie/run-saved")
async def genie_run_saved(req: GenieRunSavedRequest, _: str = Depends(get_user_token)):
    try:
        return await asyncio.to_thread(_run_saved_sync, req.id)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


@router.delete("/genie/saved/{dashboard_id}")
async def genie_delete_saved(dashboard_id: str, _: str = Depends(get_user_token)):
    try:
        await asyncio.to_thread(_delete_genie_dashboard_sync, dashboard_id)
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


@router.get("/genie/schema")
async def genie_schema(_: str = Depends(get_user_token)):
    """Return whitelisted tables filtered to the user's allowed domains. TTL-cached."""
    token      = current_token()
    whitelist  = _load_whitelist()
    accessible = await asyncio.to_thread(_get_accessible_tables_sync, token, whitelist)
    try:
        schemas = _filter_tables_by_access(
            await asyncio.to_thread(_get_all_schemas_sync),
            accessible,
        )
        return [
            {
                "table":       s["fq_name"],
                "description": s.get("description", ""),
                "domain":      s.get("domain", ""),
                "layer":       s.get("schema", ""),   # "silver" | "gold" | …
                "columns":     [{"name": c["name"], "type": c["type"]} for c in s.get("columns", [])],
            }
            for s in schemas
        ]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))
