from __future__ import annotations

from api._shared import json_response, query_params
from server import build_kpi_payload, parse_filters


def app(environ, start_response):
    filters = parse_filters(query_params(environ))
    return json_response(start_response, build_kpi_payload(filters))
