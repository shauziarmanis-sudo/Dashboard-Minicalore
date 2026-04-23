from __future__ import annotations

from api._shared import json_response
from dashboard_store import current_source_mode, trigger_sync


def _noop_sync(triggered_by: str):
    return {"status": "SKIPPED_SAMPLE_MODE", "triggered_by": triggered_by}


def app(environ, start_response):
    try:
        result = trigger_sync("CRON", _noop_sync)
    except Exception as exc:  # noqa: BLE001
        return json_response(
            start_response,
            {"error": str(exc)},
            status="503 Service Unavailable",
        )
    return json_response(
        start_response,
        {
            "message": "Cron sync selesai.",
            "result": result,
            "source_mode": current_source_mode(),
        },
    )
