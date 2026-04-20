from __future__ import annotations

from api._shared import json_response
from dashboard_store import current_source_mode, load_filter_options
from server import BRANCHES, BRANDS, CHANNELS, REFERENCE_DATE


def app(environ, start_response):
    payload = {
        **load_filter_options(
            {
                "cabang": BRANCHES,
                "brand": BRANDS,
                "channel": CHANNELS,
            }
        ),
        "defaults": {
            "start": REFERENCE_DATE.replace(day=1).isoformat(),
            "end": REFERENCE_DATE.isoformat(),
        },
        "source_mode": current_source_mode(),
    }
    return json_response(start_response, payload)
