from __future__ import annotations

from datetime import datetime, timedelta
import uuid

from api._shared import json_response, query_params, read_json_body
from dashboard_store import current_source_mode, load_filter_options, load_sync_logs, trigger_sync
from server import (
    APP_TIMEZONE,
    BRANCHES,
    BRANDS,
    CHANNELS,
    REFERENCE_DATE,
    SYNC_LOGS,
    TRANSACTIONS,
    USERS,
    build_branch_payload,
    build_brand_payload,
    build_deepdive_payload,
    build_heatmap_payload,
    build_kpi_detail_payload,
    build_kpi_payload,
    build_platform_payload,
    build_reconciliation_payload,
    build_trend_payload,
    parse_filters,
)


def _path(environ) -> str:
    raw_path = environ.get("PATH_INFO") or environ.get("REQUEST_URI") or "/api"
    path = raw_path.split("?", 1)[0]
    if path.startswith("/api/index"):
        path = path.replace("/api/index", "/api", 1)
    return path.rstrip("/") or "/api"


def _filters_response(start_response):
    payload = {
        **load_filter_options({"cabang": BRANCHES, "brand": BRANDS, "channel": CHANNELS}),
        "defaults": {
            "start": REFERENCE_DATE.replace(day=1).isoformat(),
            "end": REFERENCE_DATE.isoformat(),
        },
        "source_mode": current_source_mode(),
    }
    return json_response(start_response, payload)


def _login_response(environ, start_response):
    if environ.get("REQUEST_METHOD") != "POST":
        return json_response(start_response, {"error": "Method tidak didukung."}, status="405 Method Not Allowed")

    payload = read_json_body(environ)
    username = (payload.get("username") or "").strip().lower()
    password = payload.get("password") or ""
    user = USERS.get(username)

    if not user or user["password"] != password:
        return json_response(start_response, {"error": "Username atau password salah."}, status="401 Unauthorized")

    return json_response(
        start_response,
        {
            "name": user["name"],
            "role": user["role"],
            "pages": user["pages"],
            "username": username,
        },
    )


def _sample_sync(triggered_by: str):
    now = datetime.now(APP_TIMEZONE)
    rows_read = len(TRANSACTIONS)
    latest_log = {
        "sync_id": str(uuid.uuid4()),
        "started_at": now.isoformat(),
        "finished_at": (now + timedelta(seconds=95)).isoformat(),
        "status": "SUCCESS",
        "rows_read": rows_read,
        "rows_upserted": rows_read,
        "rows_failed": 0,
        "error_message": "",
        "triggered_by": triggered_by,
    }
    SYNC_LOGS.insert(0, latest_log)
    del SYNC_LOGS[12:]
    return latest_log


def _sync_trigger_response(environ, start_response):
    if environ.get("REQUEST_METHOD") != "POST":
        return json_response(start_response, {"error": "Method tidak didukung."}, status="405 Method Not Allowed")

    try:
        latest_log = trigger_sync("MANUAL", _sample_sync)
    except Exception as exc:  # noqa: BLE001
        return json_response(start_response, {"error": f"Sync gagal dijalankan: {exc}"}, status="503 Service Unavailable")
    return json_response(start_response, {"message": "Sync manual berhasil dipicu.", "log": latest_log})


def _sync_cron_response(start_response):
    def noop_sync(triggered_by: str):
        return {"status": "SKIPPED_SAMPLE_MODE", "triggered_by": triggered_by}

    try:
        result = trigger_sync("CRON", noop_sync)
    except Exception as exc:  # noqa: BLE001
        return json_response(start_response, {"error": str(exc)}, status="503 Service Unavailable")
    return json_response(
        start_response,
        {"message": "Cron sync selesai.", "result": result, "source_mode": current_source_mode()},
    )


def app(environ, start_response):
    path = _path(environ)
    params = query_params(environ)

    if path == "/api/login":
        return _login_response(environ, start_response)
    if path == "/api/filters":
        return _filters_response(start_response)
    if path == "/api/sync/logs":
        return json_response(start_response, {"logs": load_sync_logs(8, SYNC_LOGS), "source_mode": current_source_mode()})
    if path == "/api/sync/trigger":
        return _sync_trigger_response(environ, start_response)
    if path == "/api/sync/cron":
        return _sync_cron_response(start_response)

    filters = parse_filters(params)
    routes = {
        "/api/kpi": lambda: build_kpi_payload(filters),
        "/api/kpi/detail": lambda: build_kpi_detail_payload(filters, params.get("metric", ["gmv"])[0]),
        "/api/trend/daily": lambda: build_trend_payload(filters),
        "/api/brand": lambda: build_brand_payload(filters),
        "/api/cabang": lambda: build_branch_payload(filters),
        "/api/platform": lambda: build_platform_payload(filters),
        "/api/rekonsiliasi": lambda: build_reconciliation_payload(filters, params.get("only_difference", ["false"])[0] == "true"),
        "/api/deepdive": lambda: build_deepdive_payload(filters),
        "/api/heatmap": lambda: build_heatmap_payload(filters),
    }
    handler = routes.get(path)
    if handler is None:
        return json_response(start_response, {"error": "Endpoint tidak ditemukan.", "path": path}, status="404 Not Found")
    return json_response(start_response, handler())
