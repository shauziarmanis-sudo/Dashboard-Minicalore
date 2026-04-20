from __future__ import annotations

from api._shared import json_response
from server import SYNC_LOGS


def app(environ, start_response):
    return json_response(start_response, {"logs": SYNC_LOGS[:8]})
