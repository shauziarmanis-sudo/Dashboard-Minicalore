from __future__ import annotations

from api._shared import json_response, query_params
from server import build_reconciliation_payload, parse_filters


def app(environ, start_response):
    params = query_params(environ)
    filters = parse_filters(params)
    only_difference = params.get("only_difference", ["false"])[0] == "true"
    return json_response(start_response, build_reconciliation_payload(filters, only_difference))
