import io
import re
import os
import json
import base64
import random
import asyncio
import requests
import pandas as pd
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from dotenv import load_dotenv

# Import shared helpers from files.py to avoid duplication.
from routers.files import normalize_column_name, clean_filename, TYPE_MAP

load_dotenv()
router = APIRouter()

DATE_PAT    = r'^\d{4}-\d{2}-\d{2}$|^\d{2}/\d{2}/\d{4}$'
NUMERIC_PAT = r'^-?\d+(\.\d+)?$'


# ─────────────────────────────────────────────
# Sync helpers (run via asyncio.to_thread)
# ─────────────────────────────────────────────

def _profile_sync(contents: bytes, filename: str) -> dict:
    ext = filename.rsplit('.', 1)[-1].lower()
    if ext == 'csv':
        df = pd.read_csv(io.BytesIO(contents))
    elif ext in ('xls', 'xlsx'):
        df = pd.read_excel(io.BytesIO(contents))
    else:
        df = pd.DataFrame()

    total_rows = len(df)
    dup_count  = int(df.duplicated().sum()) if total_rows > 0 else 0
    suggested  = clean_filename(filename)

    columns = []
    for idx, col in enumerate(df.columns):
        series       = df[col]
        dtype_str    = str(series.dtype)
        detected     = TYPE_MAP.get(dtype_str, 'string')

        null_count      = int(series.isnull().sum())
        fill_rate       = (total_rows - null_count) / total_rows if total_rows > 0 else 0.0
        non_null        = series.dropna()
        unique_count    = int(non_null.nunique())
        uniqueness_ratio = unique_count / total_rows if total_rows > 0 else 0.0
        is_pk           = bool(uniqueness_ratio == 1.0 and null_count == 0)

        # Top values — string and boolean only
        top_values = []
        if detected in ('string', 'boolean'):
            vc = non_null.value_counts().head(10)
            top_values = [{'value': str(v), 'count': int(c)} for v, c in vc.items()]

        # Numeric statistics — numeric types only
        min_val = max_val = mean_val = median_val = None
        if detected in ('integer', 'float', 'timestamp') and len(non_null) > 0:
            try:
                min_val    = float(non_null.min())
                max_val    = float(non_null.max())
                mean_val   = float(non_null.mean())
                median_val = float(non_null.median())
            except Exception:
                pass

        # Sample values — up to 5 random non-null values as strings
        non_null_list = non_null.tolist()
        k = min(5, len(non_null_list))
        sample_values = [str(v) for v in random.sample(non_null_list, k)] if k > 0 else []

        # Format issues — string columns only for content checks
        format_issues = []
        if detected == 'string' and len(non_null) > 0:
            s = non_null.astype(str)
            n = len(s)
            date_hits    = s.str.match(DATE_PAT,    na=False).sum()
            numeric_hits = s.str.match(NUMERIC_PAT, na=False).sum()
            if date_hits / n > 0.8:
                format_issues.append("Looks like a date — consider casting to date")
            if numeric_hits / n > 0.8:
                format_issues.append("Looks numeric — consider casting to double or integer")
        if fill_rate < 0.7:
            format_issues.append(
                f"High null rate ({null_count} nulls, {fill_rate:.0%} filled)"
            )
        if uniqueness_ratio > 0.95 and total_rows > 100:
            format_issues.append("Very high cardinality — may be a free-text or ID column")

        columns.append({
            'name':              str(col),
            'normalized_name':   normalize_column_name(str(col)),
            'detected_type':     detected,
            'null_count':        null_count,
            'fill_rate':         round(fill_rate, 4),
            'unique_count':      unique_count,
            'uniqueness_ratio':  round(uniqueness_ratio, 4),
            'is_pk_candidate':   is_pk,
            'top_values':        top_values,
            'min_val':           min_val,
            'max_val':           max_val,
            'mean_val':          mean_val,
            'median_val':        median_val,
            'sample_values':     sample_values,
            'format_issues':     format_issues,
            'duplicate_row_count': dup_count,
            '_idx':              idx,
        })

    summary = {
        'row_count':            total_rows,
        'column_count':         len(df.columns),
        'duplicate_row_count':  dup_count,
        'file_name':            filename,
        'suggested_table_name': suggested,
    }
    return {'summary': summary, 'columns': columns}


def _call_readiness_sync(summary: dict, columns: list) -> dict:
    """Call Databricks Model Serving for an AI data-quality readiness score.
    Uses the exact same pattern as _call_serving_sync in routers/ai.py.
    """
    host     = os.getenv("DATABRICKS_HOST", "").rstrip("/")
    token    = os.getenv("DATABRICKS_TOKEN", "")
    endpoint = os.getenv("DATABRICKS_SERVING_ENDPOINT", "")

    _fallback = {
        "score":     50,
        "label":     "Warn",
        "narrative": "AI scoring unavailable. Review column statistics manually.",
        "suggestions": [],
    }

    if not all([host, token, endpoint]):
        return _fallback

    col_lines = []
    for c in columns:
        issues = "; ".join(c['format_issues']) if c['format_issues'] else "none"
        col_lines.append(
            f"  - {c['name']} | type: {c['detected_type']} "
            f"| fill: {c['fill_rate'] * 100:.1f}% "
            f"| uniqueness: {c['uniqueness_ratio'] * 100:.1f}% "
            f"| pk_candidate: {c['is_pk_candidate']} "
            f"| issues: {issues}"
        )

    prompt = (
        "You are a data quality analyst. Score this dataset for medallion pipeline readiness.\n\n"
        f"File: {summary['file_name']}\n"
        f"Rows: {summary['row_count']} | Columns: {summary['column_count']} "
        f"| Duplicate rows: {summary['duplicate_row_count']}\n\n"
        "Columns:\n" + "\n".join(col_lines) + "\n\n"
        "Respond ONLY with a JSON object — no preamble, no markdown fences:\n"
        '{\n'
        '  "score": <integer 0-100>,\n'
        '  "label": "<Pass if score>=80, Warn if 50-79, Fail if <50>",\n'
        '  "narrative": "<2-4 sentences referencing specific column names>",\n'
        '  "suggestions": ["<actionable suggestion 1>", "<actionable suggestion 2>"]\n'
        '}'
    )

    try:
        url  = f"{host}/serving-endpoints/{endpoint}/invocations"
        resp = requests.post(
            url,
            headers={
                "Authorization":  f"Bearer {token}",
                "Content-Type":   "application/json",
            },
            json={
                "messages":   [{"role": "user", "content": prompt}],
                "max_tokens": 600,
            },
            timeout=60,
        )
        resp.raise_for_status()
        content = resp.json()["choices"][0]["message"]["content"].strip()

        # Strip markdown fences if the model wrapped the response
        if content.startswith("```"):
            lines = content.splitlines()[1:]
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            content = "\n".join(lines).strip()

        return json.loads(content)
    except Exception:
        return _fallback


# ─────────────────────────────────────────────
# Endpoint
# ─────────────────────────────────────────────

class FileUpload(BaseModel):
    filename: str
    content_b64: str

@router.post("/profile-file")
async def profile_file(body: FileUpload):
    contents = base64.b64decode(body.content_b64)
    filename = body.filename or "upload"

    try:
        result = await asyncio.to_thread(_profile_sync, contents, filename)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    try:
        readiness = await asyncio.to_thread(
            _call_readiness_sync, result["summary"], result["columns"]
        )
    except Exception:
        readiness = {
            "score":       50,
            "label":       "Warn",
            "narrative":   "AI scoring unavailable. Review column statistics manually.",
            "suggestions": [],
        }

    return {
        "summary":   result["summary"],
        "columns":   result["columns"],
        "readiness": readiness,
    }
