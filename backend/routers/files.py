import io
import re
import base64
import pandas as pd
from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()

class FileUpload(BaseModel):
    filename: str
    content_b64: str

TYPE_MAP = {
    'int64':          'integer',
    'int32':          'integer',
    'float64':        'float',
    'float32':        'float',
    'bool':           'boolean',
    'object':         'string',
    'datetime64[ns]': 'timestamp',
    'datetime64[us]': 'timestamp',
}

def clean(val):
    if hasattr(val, 'item'):
        return val.item()
    return val

def clean_filename(name: str) -> str:
    """Clean filename into a safe snake_case table/job name. Strips a trailing
    run-date stamp (e.g. _20260811) only — never a lone trailing 4-digit
    number, since that can be meaningful content (e.g. a year within the
    name, like "...2020_to_2024")."""
    name = name.rsplit('.', 1)[0]
    name = re.sub(r'[^a-zA-Z0-9]+', '_', name)
    name = re.sub(r'_?\d{4}_?\d{2}_?\d{2}$', '', name)
    name = re.sub(r'_?\d{2}_?\d{2}_?\d{4}$', '', name)
    name = re.sub(r'_+', '_', name)
    name = name.strip('_').lower()
    return name

def normalize_column_name(col_name: str) -> str:
    """
    Normalize column name to be database-safe:
    1. Strip leading/trailing whitespace
    2. Replace spaces, dashes, slashes with underscore
    3. Remove apostrophes and parentheses
    4. Remove any character not alphanumeric or underscore (DB standard)
    5. Collapse multiple underscores
    6. Remove leading/trailing underscores
    7. If starts with digit, prefix with col_
    """
    col_name = col_name.strip()
    col_name = re.sub(r"[ \-/\\]+", "_", col_name)
    col_name = re.sub(r"[\'\(\)\[\]\{\}\.\,\;\:\!\?\@\#\$\%\^\&\*\+\=\~\`\"]+", "", col_name)
    col_name = re.sub(r"[^a-zA-Z0-9_]", "", col_name)
    col_name = re.sub(r"_+", "_", col_name)
    col_name = col_name.strip("_")
    if col_name and col_name[0].isdigit():
        col_name = f"col_{col_name}"
    return col_name or "unnamed"

@router.post("/parse-file")
async def parse_file(body: FileUpload):
    contents = base64.b64decode(body.content_b64)
    filename = body.filename or "upload"
    ext      = filename.rsplit('.', 1)[-1].lower()

    if ext == 'csv':
        df          = pd.read_csv(io.BytesIO(contents), nrows=100)
        source_type = 'csv'
        delimiter   = ','
    elif ext in ('xls', 'xlsx'):
        df          = pd.read_excel(io.BytesIO(contents), nrows=100)
        source_type = 'excel'
        delimiter   = ''          # excel has no delimiter
    else:
        # parquet, json, other — return empty df, let user configure
        df          = pd.DataFrame()
        source_type = ext
        delimiter   = ''          # user will fill in if needed

    safe = clean_filename(filename)

    columns = []
    for col in df.columns:
        dtype      = str(df[col].dtype)
        null_pct   = round(float(df[col].isnull().mean() * 100), 1)
        sample     = [str(clean(s)) for s in df[col].dropna().head(3).tolist()]
        safe_col   = normalize_column_name(col)
        columns.append({
            "name":           col,
            "safe_name":      safe_col,
            "detected_type":  TYPE_MAP.get(dtype, 'string'),
            "nullable":       bool(null_pct > 0),
            "null_pct":       null_pct,
            "sample_values":  sample,
            "is_primary_key": False,
            "data_type":      None,
            "description":    "",
            "pii":            "none",
            "classification": "internal",
        })

    schema_mapping = ', '.join(
        f"{normalize_column_name(c['name'])} {c['detected_type'].capitalize()}"
        for c in columns
    )
    column_order = ', '.join(normalize_column_name(c['name']) for c in columns)

    return {
        "columns":   columns,
        "row_count": int(len(df)),
        "file_meta": {
            "safe_name":        safe,
            "source_filename":  filename.rsplit('.', 1)[0],
            "source_type":      source_type,
            "source_delimiter": delimiter,
            "schema_mapping":   schema_mapping,
            "column_order":     column_order,
            "is_other_type":    ext not in ('csv', 'xls', 'xlsx'),
        }
    }