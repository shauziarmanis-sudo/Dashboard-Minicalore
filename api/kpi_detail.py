from __future__ import annotations

from api._shared import json_response, query_params
from server import build_kpi_detail_payload, parse_filters


def app(environ, start_response):
    params = query_params(environ)
    filters = parse_filters(params)
    metric = params.get("metric", ["gmv"])[0]
    return json_response(start_response, build_kpi_detail_payload(filters, metric))
