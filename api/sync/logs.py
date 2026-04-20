from __future__ import annotations

from api._shared import json_response
from dashboard_store import current_source_mode, load_sync_logs
from server import SYNC_LOGS


def app(environ, start_response):
    return json_response(start_response, {"logs": load_sync_logs(8, SYNC_LOGS), "source_mode": current_source_mode()})
