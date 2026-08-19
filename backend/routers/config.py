import os
import re
import asyncio
from fastapi import APIRouter, HTTPException, Depends
from auth import get_user_token, current_token, sql_token
from pydantic import BaseModel
from typing import List, Optional
from dotenv import load_dotenv

load_dotenv()
router = APIRouter()

TABLE_REF = "catalog_central.medallion_config.tbl_config"

# ─────────────────────────────────────────────
# Databricks connection
# ─────────────────────────────────────────────
def get_conn():
    from databricks import sql as dbsql
    host      = os.getenv("DATABRICKS_HOST", "").replace("https://", "").replace("http://", "").rstrip("/")
    http_path = os.getenv("DATABRICKS_HTTP_PATH", "")
    token     = sql_token()
    if not all([host, http_path, token]):
        raise HTTPException(500, "DATABRICKS_HOST / DATABRICKS_HTTP_PATH / DATABRICKS_TOKEN missing from .env")
    return dbsql.connect(
        server_hostname=host,
        http_path=http_path,
        access_token=token,
    )

# ─────────────────────────────────────────────
# Column normalizer
# ─────────────────────────────────────────────
DATABRICKS_RESERVED = {
    "select","from","where","table","column","index","view","create",
    "drop","insert","update","delete","merge","into","values","set",
    "and","or","not","null","true","false","case","when","then","else",
    "end","join","left","right","inner","outer","on","group","by",
    "order","having","limit","offset","union","all","distinct","as",
    "with","partition","cluster","sort","like","in","between","exists",
    "is","using","natural","cross","full","cast","over","row","rows",
    "range","unbounded","preceding","following","current","database",
    "schema","catalog","use","show","describe","explain","analyze",
}

def normalize_column_name(col_name: str) -> str:
    col_name = col_name.strip()
    col_name = re.sub(r"[ \-/\\]+", "_", col_name)
    col_name = re.sub(r"[\'\(\)\[\]\{\}\.\,\;\:\!\?\@\#\$\%\^\&\*\+\=\~\`\"]+", "", col_name)
    col_name = re.sub(r"[^a-zA-Z0-9_]", "", col_name)
    col_name = re.sub(r"_+", "_", col_name)
    col_name = col_name.strip("_")
    if col_name and col_name[0].isdigit():
        col_name = f"col_{col_name}"
    return col_name or "unnamed"

def is_valid_db_column(name: str) -> bool:
    if not name:
        return False
    if not re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', name):
        return False
    if len(name) > 255:
        return False
    if name.lower() in DATABRICKS_RESERVED:
        return False
    return True

RESERVED_DOMAIN_NAMES = {"central", "cross_ncss"}
DOMAIN_NAME_RE = re.compile(r'^[a-z][a-z0-9_]{0,50}$')

def validate_domain_name(name: str) -> str:
    name = (name or "").strip().lower()
    if not name:
        raise HTTPException(400, "New domain name is required")
    if not DOMAIN_NAME_RE.match(name):
        raise HTTPException(
            400,
            "Domain name must start with a lowercase letter and contain only "
            "lowercase letters, numbers, and underscores",
        )
    if name in RESERVED_DOMAIN_NAMES:
        raise HTTPException(400, f"'{name}' is a reserved name and cannot be used as a domain")
    return name

def remove_date_suffix(name: str) -> str:
    name = re.sub(r'[_\-]?\d{4}[_\-]?\d{2}[_\-]?\d{2}$', '', name)
    name = re.sub(r'[_\-]?\d{2}[_\-]?\d{2}[_\-]?\d{4}$', '', name)
    name = re.sub(r'[_\-]?\d{8}$', '', name)
    name = re.sub(r'[_\-]?\d{4}$', '', name)
    name = re.sub(r'_+$', '', name)
    return name.strip('_')

# ─────────────────────────────────────────────
# Models
# ─────────────────────────────────────────────
class ColumnConfig(BaseModel):
    name: str
    safe_name: str
    detected_type: str
    nullable: bool = True
    null_pct: float = 0
    sample_values: List[str] = []
    is_primary_key: bool = False
    data_type: Optional[str] = None
    description: str = ""
    pii: str = "none"
    classification: str = "internal"

class TableConfig(BaseModel):
    job_name: str
    source_system: str = "NCSS"
    target_category: str = "daily"
    active: bool = True
    load_sequence: int = 1
    owner: str = "NCSS"
    domain: str = "sg"
    pipeline_name: str = "pipeline_01_raw_to_bronze"
    source_entity_name: str = ""
    source_type: str = "csv"
    source_filename: str = ""
    source_path: str = ""
    source_delimiter: str = ","
    bronze_catalog_name: str = ""
    bronze_schema_name: str = "bronze"
    bronze_table_name: str = ""
    bronze_table_path: str = ""
    bronze_archive_path: str = ""
    bronze_write_mode: str = "overwrite"
    bronze_load_type: str = "full"
    silver_catalog_name: str = ""
    silver_schema_name: str = "silver"
    silver_table_name: str = ""
    silver_curated_path: str = ""
    silver_history_path: str = ""
    silver_invalid_path: str = ""
    silver_write_mode: str = "overwrite"
    silver_load_type: str = "full"
    silver_mandatory_columns: str = ""
    columns: List[ColumnConfig] = []

# ─────────────────────────────────────────────
# Validate column names endpoint
# ─────────────────────────────────────────────
@router.post("/validate-columns")
async def validate_columns(payload: List[ColumnConfig], _: str = Depends(get_user_token)):
    errors = []
    for col in payload:
        if not is_valid_db_column(col.safe_name):
            if not col.safe_name:
                reason = "Cannot be empty"
            elif col.safe_name[0].isdigit():
                reason = "Cannot start with a number"
            elif col.safe_name.lower() in DATABRICKS_RESERVED:
                reason = f"'{col.safe_name}' is a reserved Databricks keyword"
            elif len(col.safe_name) > 255:
                reason = "Exceeds 255 characters"
            else:
                reason = "Contains invalid characters — only letters, numbers, underscores allowed"
            errors.append({
                "column":    col.name,
                "safe_name": col.safe_name,
                "reason":    reason,
            })
    return {"valid": len(errors) == 0, "errors": errors}

# ─────────────────────────────────────────────
# SQL literal helper
# ─────────────────────────────────────────────
BOOL_COLS = {"active", "bronze_active_status", "silver_active_status"}
INT_COLS  = {"load_sequence"}

def sql_literal(key: str, val) -> str:
    """Convert a Python value to an inline SQL literal safe for Databricks."""
    if val is None:
        return "NULL"
    if key in BOOL_COLS:
        return "TRUE" if val else "FALSE"
    if key in INT_COLS:
        return str(int(val))
    return "'" + str(val).replace("'", "''") + "'"

# ─────────────────────────────────────────────
# Columns in MERGE — excludes id, created_at, updated_at
# ─────────────────────────────────────────────
MERGE_COLS = [
    "job_name", "source_system", "target_category", "active", "load_sequence",
    "owner", "domain", "source_entity_name", "source_type", "source_filename",
    "source_path", "source_delimiter", "pipeline_name", "lakehouse_group",
    "bronze_catalog_name", "bronze_schema_name", "bronze_table_name",
    "bronze_table_path", "bronze_archive_path", "bronze_column_order",
    "bronze_write_mode", "bronze_schema_mapping", "bronze_load_type",
    "bronze_active_status", "bronze_silver_count_table_path",
    "silver_catalog_name", "silver_schema_name", "silver_table_name",
    "silver_curated_path", "silver_history_path", "silver_invalid_path",
    "silver_column_order", "silver_write_mode", "silver_schema_mapping",
    "silver_primary_key", "silver_merge_keys", "silver_partition_key",
    "silver_mandatory_columns", "silver_filter_condition", "silver_load_type",
    "silver_active_status", "sheet_name",
]

# ─────────────────────────────────────────────
# Sync save — runs in thread to avoid blocking FastAPI
# ─────────────────────────────────────────────
def _save_sync(row: dict):
    conn   = get_conn()
    cursor = conn.cursor()

    select_parts = ",\n        ".join(
        f"{sql_literal(c, row.get(c))} AS {c}" for c in MERGE_COLS
    )
    update_parts = ",\n        ".join(
        f"target.{c} = source.{c}" for c in MERGE_COLS if c != "job_name"
    )
    insert_cols = ", ".join(MERGE_COLS)
    insert_vals = ", ".join(f"source.{c}" for c in MERGE_COLS)

    merge_sql = f"""
MERGE INTO {TABLE_REF} AS target
USING (
  SELECT
    {select_parts}
) AS source
ON target.job_name = source.job_name
WHEN MATCHED THEN UPDATE SET
    {update_parts}
WHEN NOT MATCHED THEN INSERT
    ({insert_cols})
    VALUES ({insert_vals})
"""

    try:
        cursor.execute(merge_sql)
    except Exception as e:
        cursor.close()
        conn.close()
        raise e

    cursor.close()
    conn.close()

# ─────────────────────────────────────────────
# Save config endpoint
# ─────────────────────────────────────────────
@router.post("/save-config")
async def save_config(payload: TableConfig, _: str = Depends(get_user_token)):
    pk_cols  = [c for c in payload.columns if c.is_primary_key]
    all_cols = payload.columns

    bronze_col_order  = ', '.join(c.safe_name for c in all_cols)
    bronze_schema_map = ', '.join(
        f"{c.safe_name} {(c.data_type or c.detected_type).capitalize()}"
        for c in all_cols
    )
    pk_string      = ', '.join(c.safe_name for c in pk_cols)
    mandatory_cols = ', '.join(c.safe_name for c in all_cols if not c.nullable)

    clean_source_filename = remove_date_suffix(payload.source_filename)

    row = {
        # Job identity
        "job_name":                       payload.job_name,
        "source_system":                  payload.source_system,
        "target_category":                payload.target_category,
        "active":                         payload.active,
        "load_sequence":                  payload.load_sequence,
        "owner":                          payload.owner,
        "domain":                         payload.domain,
        "pipeline_name":                  payload.pipeline_name,

        # Source
        "source_entity_name":             payload.source_entity_name,
        "source_type":                    payload.source_type,
        "source_filename":                clean_source_filename,
        "source_path":                    payload.source_path,
        "source_delimiter":               payload.source_delimiter,

        # Blanked fields
        "lakehouse_group":                "",
        "sheet_name":                     "",
        "bronze_silver_count_table_path": "",
        "silver_partition_key":           "",
        "silver_filter_condition":        "",
        "bronze_active_status":           None,
        "silver_active_status":           None,

        # Bronze — fixed rules
        "bronze_catalog_name":            payload.bronze_catalog_name,
        "bronze_schema_name":             "bronze",
        "bronze_table_name":              payload.bronze_table_name,
        "bronze_table_path":              f"{payload.bronze_catalog_name}.bronze.{payload.bronze_table_name}",
        "bronze_archive_path":            payload.bronze_archive_path,
        "bronze_column_order":            bronze_col_order,
        "bronze_write_mode":              "overwrite",
        "bronze_schema_mapping":          bronze_schema_map,
        "bronze_load_type":               "full",

        # Silver
        "silver_catalog_name":            payload.silver_catalog_name,
        "silver_schema_name":             "silver",
        "silver_table_name":              payload.silver_table_name,
        "silver_curated_path":            payload.silver_curated_path,
        "silver_history_path":            payload.silver_history_path,
        "silver_invalid_path":            payload.silver_invalid_path,
        "silver_column_order":            bronze_col_order,
        "silver_write_mode":              "merge",
        "silver_schema_mapping":          bronze_schema_map,
        "silver_primary_key":             pk_string,
        "silver_merge_keys":              pk_string,
        "silver_mandatory_columns":       mandatory_cols,
        "silver_load_type":               payload.silver_load_type,
    }

    try:
        await asyncio.to_thread(_save_sync, row)
        return {"status": "saved", "job_name": payload.job_name, **row}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ─────────────────────────────────────────────
# List configs endpoint
# ─────────────────────────────────────────────
@router.get("/configs")
async def list_configs(_: str = Depends(get_user_token)):
    def _list():
        conn   = get_conn()
        cursor = conn.cursor()
        cursor.execute(f"SELECT * FROM {TABLE_REF} ORDER BY job_name")
        cols = [d[0] for d in cursor.description]
        rows = [dict(zip(cols, row)) for row in cursor.fetchall()]
        cursor.close()
        conn.close()
        return rows
    try:
        return await asyncio.to_thread(_list)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ─────────────────────────────────────────────
# Domain (catalog) discovery + creation
# ─────────────────────────────────────────────
RAW_VOLUMES = ["file_upload", "ad_hoc_upload", "archive"]
DOMAIN_SCHEMAS = ["raw", "bronze", "silver", "gold"]

class DomainCreate(BaseModel):
    name: str

def _list_domains_sync() -> List[str]:
    conn   = get_conn()
    cursor = conn.cursor()
    try:
        cursor.execute("SHOW CATALOGS")
        names = [row[0] for row in cursor.fetchall()]
    finally:
        cursor.close()
        conn.close()
    return sorted(
        name[len("catalog_"):]
        for name in names
        if name.startswith("catalog_") and name[len("catalog_"):] not in RESERVED_DOMAIN_NAMES
    )

ADMIN_GROUP = os.getenv("UC_ADMIN_GROUP", "admins")

def _create_domain_sync(domain: str) -> str:
    catalog = f"catalog_{domain}"
    conn    = get_conn()
    cursor  = conn.cursor()
    try:
        cursor.execute(f"CREATE CATALOG IF NOT EXISTS {catalog}")
        try:
            cursor.execute(f"GRANT MANAGE ON CATALOG {catalog} TO `{ADMIN_GROUP}`")
        except Exception as e:
            print(f"[_create_domain_sync] WARNING: could not grant MANAGE on {catalog} to '{ADMIN_GROUP}': {e}")
        for schema in DOMAIN_SCHEMAS:
            cursor.execute(f"CREATE SCHEMA IF NOT EXISTS {catalog}.{schema}")
        for volume in RAW_VOLUMES:
            cursor.execute(f"CREATE VOLUME IF NOT EXISTS {catalog}.raw.{volume}")
    finally:
        cursor.close()
        conn.close()
    return catalog

@router.get("/domains")
async def list_domains(_: str = Depends(get_user_token)):
    try:
        domains = await asyncio.to_thread(_list_domains_sync)
        return {"domains": domains}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/domains")
async def create_domain(req: DomainCreate, _: str = Depends(get_user_token)):
    name = validate_domain_name(req.name)
    try:
        catalog = await asyncio.to_thread(_create_domain_sync, name)
        return {"status": "created", "domain": name, "catalog": catalog}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ─────────────────────────────────────────────
# Config table existence check + bootstrap
# ─────────────────────────────────────────────
CONFIG_CATALOG = "catalog_central"
CONFIG_SCHEMA  = "medallion_config"
CONFIG_TABLE   = "tbl_config"

CONFIG_TABLE_DDL = f"""
CREATE TABLE IF NOT EXISTS {TABLE_REF} (
    id BIGINT GENERATED ALWAYS AS IDENTITY,
    job_name STRING NOT NULL,
    source_system STRING,
    target_category STRING,
    active BOOLEAN,
    load_sequence INT,
    owner STRING,
    domain STRING,
    source_entity_name STRING,
    source_type STRING,
    source_filename STRING,
    source_path STRING,
    source_delimiter STRING,
    pipeline_name STRING,
    lakehouse_group STRING,
    bronze_catalog_name STRING,
    bronze_schema_name STRING,
    bronze_table_name STRING,
    bronze_table_path STRING,
    bronze_archive_path STRING,
    bronze_column_order STRING,
    bronze_write_mode STRING,
    bronze_schema_mapping STRING,
    bronze_load_type STRING,
    bronze_active_status BOOLEAN,
    bronze_silver_count_table_path STRING,
    silver_catalog_name STRING,
    silver_schema_name STRING,
    silver_table_name STRING,
    silver_curated_path STRING,
    silver_history_path STRING,
    silver_invalid_path STRING,
    silver_column_order STRING,
    silver_write_mode STRING,
    silver_schema_mapping STRING,
    silver_primary_key STRING,
    silver_merge_keys STRING,
    silver_partition_key STRING,
    silver_mandatory_columns STRING,
    silver_filter_condition STRING,
    silver_load_type STRING,
    silver_active_status BOOLEAN,
    sheet_name STRING,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
) USING DELTA
TBLPROPERTIES ('delta.feature.allowColumnDefaults' = 'supported')
"""

def _config_table_status_sync() -> dict:
    conn   = get_conn()
    cursor = conn.cursor()
    catalog_exists = schema_exists = table_exists = False
    try:
        cursor.execute(f"SHOW CATALOGS LIKE '{CONFIG_CATALOG}'")
        catalog_exists = len(cursor.fetchall()) > 0
        if catalog_exists:
            cursor.execute(f"SHOW SCHEMAS IN {CONFIG_CATALOG} LIKE '{CONFIG_SCHEMA}'")
            schema_exists = len(cursor.fetchall()) > 0
        if schema_exists:
            cursor.execute(f"SHOW TABLES IN {CONFIG_CATALOG}.{CONFIG_SCHEMA} LIKE '{CONFIG_TABLE}'")
            table_exists = len(cursor.fetchall()) > 0
    finally:
        cursor.close()
        conn.close()
    return {
        "catalog_exists": catalog_exists,
        "schema_exists":  schema_exists,
        "table_exists":   table_exists,
    }

def _create_config_table_sync():
    conn   = get_conn()
    cursor = conn.cursor()
    try:
        cursor.execute(f"CREATE CATALOG IF NOT EXISTS {CONFIG_CATALOG}")
        cursor.execute(f"CREATE SCHEMA IF NOT EXISTS {CONFIG_CATALOG}.{CONFIG_SCHEMA}")
        cursor.execute(CONFIG_TABLE_DDL)
    finally:
        cursor.close()
        conn.close()

@router.get("/config-table-status")
async def config_table_status(_: str = Depends(get_user_token)):
    try:
        return await asyncio.to_thread(_config_table_status_sync)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/config-table")
async def create_config_table(_: str = Depends(get_user_token)):
    try:
        await asyncio.to_thread(_create_config_table_sync)
        return await asyncio.to_thread(_config_table_status_sync)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))