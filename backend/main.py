import os
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from dotenv import load_dotenv
from routers import files, ai, config, volumes, jobs, dictionary, jobrun, genie, profiling

load_dotenv()

# Databricks Apps injects CLIENT_ID + CLIENT_SECRET instead of a PAT.
# Exchange them for an access token so all routers can use DATABRICKS_TOKEN as usual.
if not os.getenv("DATABRICKS_TOKEN"):
    _host       = os.getenv("DATABRICKS_HOST", "").rstrip("/")
    _client_id  = os.getenv("DATABRICKS_CLIENT_ID", "")
    _client_sec = os.getenv("DATABRICKS_CLIENT_SECRET", "")
    if _host and _client_id and _client_sec:
        import requests as _req
        try:
            _r = _req.post(
                f"{_host}/oidc/v1/token",
                data={"grant_type": "client_credentials",
                      "client_id": _client_id,
                      "client_secret": _client_sec,
                      "scope": "all-apis"},
                timeout=10,
            )
            if _r.ok:
                os.environ["DATABRICKS_TOKEN"] = _r.json()["access_token"]
        except Exception:
            pass

app = FastAPI(title="AAK Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(files.router, prefix="/api")
app.include_router(ai.router, prefix="/api")
app.include_router(config.router, prefix="/api")
app.include_router(volumes.router, prefix="/api")
app.include_router(jobs.router, prefix="/api")
app.include_router(dictionary.router, prefix="/api")
app.include_router(jobrun.router, prefix="/api")
app.include_router(genie.router,      prefix="/api")
app.include_router(profiling.router,  prefix="/api")

@app.get("/api/me")
async def get_me(request: Request):
    import asyncio, requests as _req
    from auth import get_user_token

    token = get_user_token(request)
    host  = os.getenv("DATABRICKS_HOST", "").rstrip("/")

    # Local dev: no forwarded token means we're running outside Databricks Apps.
    # Return data_engineer so all modules are accessible during development.
    is_forwarded = bool(request.headers.get("X-Forwarded-Access-Token", ""))
    if not is_forwarded:
        return {"display_name": "Local Dev", "user_name": "local", "groups": [], "role": "data_engineer"}

    def _fetch():
        return _req.get(
            f"{host}/api/2.0/preview/scim/v2/Me",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )

    try:
        r    = await asyncio.to_thread(_fetch)
        data = r.json() if r.ok else {}
    except Exception:
        data = {}

    groups = [g.get("display", "") for g in data.get("groups", [])]

    if "data_engineer" in groups:
        role = "data_engineer"
    elif any(g.startswith("basic_user_") for g in groups):
        role = "basic_user"
    else:
        # Temporary bypass: allow users without application groups to access the UI.
        role = "data_engineer"

    return {
        "display_name": data.get("displayName", ""),
        "user_name":    data.get("userName", ""),
        "groups":       groups,
        "role":         role,
    }


@app.get("/api/debug-uc-tables")
async def debug_uc_tables(request: Request):
    """Temporary: shows which whitelist tables the current user can access (SQL probe approach)."""
    import asyncio
    from auth import get_user_token, current_token
    from routers.genie import _get_accessible_tables_sync, _load_whitelist
    get_user_token(request)
    token     = current_token()
    whitelist = _load_whitelist()
    accessible = await asyncio.to_thread(_get_accessible_tables_sync, token, whitelist)
    return {
        "token_is_sp":       token == os.getenv("DATABRICKS_TOKEN", ""),
        "accessible_tables": sorted(accessible) if accessible is not None else "unrestricted",
        "all_whitelist":     [f"{e['catalog']}.{e['schema']}.{e['table']}" for e in whitelist],
    }


@app.get("/api/debug-headers")
async def debug_headers(request: Request):
    from auth import get_user_token, current_token
    get_user_token(request)
    tok = current_token()
    forwarded = request.headers.get("X-Forwarded-Access-Token", "")
    return {
        "forwarded_token_length": len(forwarded),
        "current_token_length":   len(tok),
        "tokens_match":           tok == forwarded,
        "using_env_fallback":     tok == os.getenv("DATABRICKS_TOKEN", ""),
        "client_id":              os.getenv("DATABRICKS_CLIENT_ID", "NOT SET"),
    }

# Serve the built React frontend (production only — dist/ is absent in local dev)
_DIST = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
if os.path.isdir(_DIST):
    app.mount("/assets", StaticFiles(directory=os.path.join(_DIST, "assets")), name="assets")

    @app.get("/{_full_path:path}")
    async def serve_spa(_full_path: str = ""):
        return FileResponse(os.path.join(_DIST, "index.html"))