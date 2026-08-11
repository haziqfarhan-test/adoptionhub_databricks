import os
from contextvars import ContextVar
from fastapi import Request

_user_token: ContextVar[str] = ContextVar("user_token", default="")


def get_user_token(request: Request) -> str:
    """FastAPI dependency — extracts the logged-in user's token from the
    Databricks Apps proxy header and stores it in the async context."""
    token = (
        request.headers.get("X-Forwarded-Access-Token", "")
        or os.getenv("DATABRICKS_TOKEN", "")
    )
    _user_token.set(token)
    return token


def current_token() -> str:
    """User token for the current request — use for REST API calls (Jobs, Files)
    so audit logs in Databricks show the real user identity."""
    return _user_token.get() or os.getenv("DATABRICKS_TOKEN", "")


def sql_token() -> str:
    """Service principal token — use for SQL warehouse connections.
    The X-Forwarded-Access-Token OAuth scope is not accepted by the SQL connector;
    the M2M service principal token (set at startup) is reliable for Unity Catalog."""
    return os.getenv("DATABRICKS_TOKEN", "")
