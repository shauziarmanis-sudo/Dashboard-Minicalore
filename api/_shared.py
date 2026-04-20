from __future__ import annotations

import json
from urllib.parse import parse_qs


def json_response(start_response, payload: dict, status: str = "200 OK"):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = [
        ("Content-Type", "application/json; charset=utf-8"),
        ("Content-Length", str(len(body))),
        ("Cache-Control", "no-store"),
    ]
    start_response(status, headers)
    return [body]


def read_json_body(environ) -> dict:
    try:
        length = int(environ.get("CONTENT_LENGTH") or "0")
    except ValueError:
        length = 0

    raw = environ["wsgi.input"].read(length) if length else b""
    if not raw:
        return {}
    return json.loads(raw.decode("utf-8"))


def query_params(environ) -> dict:
    return parse_qs(environ.get("QUERY_STRING", ""), keep_blank_values=True)
