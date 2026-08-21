import os
import json
import asyncio
import requests
from fastapi import APIRouter, HTTPException, Depends
from auth import get_user_token, current_token, extract_llm_text
from pydantic import BaseModel
from typing import List, Any, Optional
from dotenv import load_dotenv

load_dotenv()

router = APIRouter()


def _call_serving_sync(prompt: str, max_tokens: int) -> str:
    host = os.getenv("DATABRICKS_HOST", "").rstrip("/")
    token = current_token()
    endpoint = os.getenv("DATABRICKS_SERVING_ENDPOINT", "")
    if not endpoint:
        raise ValueError("DATABRICKS_SERVING_ENDPOINT is not set in .env")
    url = f"{host}/serving-endpoints/{endpoint}/invocations"
    resp = requests.post(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json={
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": max_tokens,
        },
        timeout=60,
    )
    resp.raise_for_status()
    return extract_llm_text(resp.json()["choices"][0]["message"])


def _strip_md_fences(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    return text


class Column(BaseModel):
    name: str
    detected_type: str
    sample_values: List[Any] = []
    safe_name: str = ""
    description: str = ""
    pii: str = "none"
    classification: str = "internal"
    nullable: bool = True
    null_pct: float = 0
    is_primary_key: bool = False
    data_type: Optional[str] = None


class EnrichRequest(BaseModel):
    columns: List[Column]


class DictLogicRequest(BaseModel):
    element_name: str
    technical_logic: str
    description: str = ""


SKIP_LOGIC_SET = {"Align with Data Format", "MASTER_CODE_LOOKUP", "Not required"}


@router.post("/enrich-columns")
async def enrich_columns(req: EnrichRequest, _: str = Depends(get_user_token)):
    col_summary = "\n".join([
        f"- {c.name} (type: {c.detected_type}, samples: {c.sample_values[:3]}, null%: {c.null_pct})"
        for c in req.columns
    ])

    prompt = f"""You are a data governance expert. Given these dataset columns, return enriched metadata.

Columns:
{col_summary}

For each column return a JSON array with objects containing:
- name (exact match to input)
- description (clear business description, 1 sentence)
- pii ("none", "pii", or "sensitive")
- classification ("public", "internal", "confidential", or "restricted")

Return ONLY the JSON array, no explanation."""

    try:
        text = await asyncio.to_thread(_call_serving_sync, prompt, 2000)
        enriched_list = json.loads(_strip_md_fences(text))
    except requests.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Serving endpoint error: {e.response.text}")
    except (json.JSONDecodeError, KeyError) as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse model response: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    enriched_map = {e["name"]: e for e in enriched_list}

    result = []
    for col in req.columns:
        merged = col.model_dump()
        if col.name in enriched_map:
            merged.update({
                "description": enriched_map[col.name].get("description", col.description),
                "pii": enriched_map[col.name].get("pii", col.pii),
                "classification": enriched_map[col.name].get("classification", col.classification),
            })
        result.append(merged)

    return result


@router.post("/generate-dict-logic")
async def generate_dict_logic(req: DictLogicRequest, _: str = Depends(get_user_token)):
    if not req.technical_logic.strip() or req.technical_logic.strip() in SKIP_LOGIC_SET:
        return {"sql": ""}

    prompt = f"""You are a Spark SQL data quality engineer.

Convert the technical logic below into a single-line Spark SQL condition for the column `{req.element_name}`.

Technical logic: {req.technical_logic}
Description: {req.description}

Rules (strictly follow all):
- Output a single-line Spark SQL expression only
- Do NOT include WHERE, NOT, parentheses, line breaks, or comments
- The output will be placed inside: invalid_df = df.filter(f"NOT (<output>)")
- Only return the Spark SQL expression — no explanation, no markdown, no quotes

If the logic cannot be expressed as a Spark SQL condition, return an empty string."""

    try:
        text = await asyncio.to_thread(_call_serving_sync, prompt, 500)
    except requests.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Serving endpoint error: {e.response.text}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {"sql": text.strip()}
