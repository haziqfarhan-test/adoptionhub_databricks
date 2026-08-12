import os
import time
from contextvars import ContextVar

import requests
from fastapi import HTTPException, Request

_user_token: ContextVar[str] = ContextVar("user_token", default="")

_sp_token_cache = {"token": "", "expires_at": 0.0}


def get_user_token(request: Request) -> str:
    """FastAPI dependency — route gate only. The forwarded user token is captured
    for logging/debugging but is intentionally NOT used for Databricks calls;
    every backend action runs as the app's service principal (see
    service_principal_token())."""
    token = request.headers.get("X-Forwarded-Access-Token", "")
    _user_token.set(token)
    return token


def _fetch_sp_oauth_token() -> str:
    """Exchange the app's own client_id/client_secret for an OAuth M2M token.
    Databricks Apps auto-injects DATABRICKS_CLIENT_ID/SECRET/HOST for the app's
    service principal — no manual token management needed in production."""
    host          = os.getenv("DATABRICKS_HOST", "").rstrip("/")
    client_id     = os.getenv("DATABRICKS_CLIENT_ID", "")
    client_secret = os.getenv("DATABRICKS_CLIENT_SECRET", "")

    missing = [name for name, value in [
        ("DATABRICKS_HOST", host),
        ("DATABRICKS_CLIENT_ID", client_id),
        ("DATABRICKS_CLIENT_SECRET", client_secret),
    ] if not value]
    if missing:
        raise HTTPException(
            500,
            f"No service principal token available. Missing env vars: {', '.join(missing)}."
        )

    resp = requests.post(
        f"{host}/oidc/v1/token",
        data={
            "grant_type": "client_credentials",
            "client_id": client_id,
            "client_secret": client_secret,
            "scope": "all-apis",
        },
        timeout=10,
    )
    if not resp.ok:
        raise HTTPException(
            500,
            f"Service principal token request failed ({resp.status_code}): {resp.text}"
        )

    data = resp.json()
    access_token = data.get("access_token", "")
    if not access_token:
        raise HTTPException(
            500,
            "Service principal token request succeeded but returned no access_token."
        )

    _sp_token_cache["token"]      = access_token
    _sp_token_cache["expires_at"] = time.time() + int(data.get("expires_in", 3600)) - 60
    return access_token


def service_principal_token() -> str:
    """The single credential used for ALL Databricks actions (SQL, Jobs API,
    Files/Volumes API, Model Serving) — the app's own service principal, never
    the calling user's identity.

    Prefers a static DATABRICKS_TOKEN (useful for local dev); otherwise
    exchanges DATABRICKS_CLIENT_ID/SECRET for a cached OAuth M2M token."""
    static = os.getenv("DATABRICKS_TOKEN", "")
    if static:
        return static

    if _sp_token_cache["token"] and time.time() < _sp_token_cache["expires_at"]:
        return _sp_token_cache["token"]

    return _fetch_sp_oauth_token()


def current_token() -> str:
    """REST API calls (Jobs, Files, Model Serving) — service principal token."""
    return service_principal_token()


def sql_token() -> str:
    """SQL warehouse connections — service principal token."""
    return service_principal_token()
