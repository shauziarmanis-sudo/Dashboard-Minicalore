from __future__ import annotations

from datetime import datetime, timedelta
import uuid

from api._shared import json_response
from dashboard_store import trigger_sync
from server import APP_TIMEZONE, SYNC_LOGS, TRANSACTIONS


def sample_sync(triggered_by: str):
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


def app(environ, start_response):
    if environ.get("REQUEST_METHOD") != "POST":
        return json_response(start_response, {"error": "Method tidak didukung."}, status="405 Method Not Allowed")

    try:
        latest_log = trigger_sync("MANUAL", sample_sync)
    except Exception as exc:  # noqa: BLE001
        return json_response(
            start_response,
            {"error": f"Sync gagal dijalankan: {exc}"},
            status="503 Service Unavailable",
        )
    return json_response(start_response, {"message": "Sync manual berhasil dipicu.", "log": latest_log})
