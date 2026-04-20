from __future__ import annotations

from api._shared import json_response
from server import BRANCHES, BRANDS, CHANNELS, REFERENCE_DATE


def app(environ, start_response):
    payload = {
        "cabang": BRANCHES,
        "brand": BRANDS,
        "channel": CHANNELS,
        "defaults": {
            "start": REFERENCE_DATE.replace(day=1).isoformat(),
            "end": REFERENCE_DATE.isoformat(),
        },
    }
    return json_response(start_response, payload)
