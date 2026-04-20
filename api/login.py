from __future__ import annotations

from api._shared import json_response, read_json_body
from server import USERS


def app(environ, start_response):
    if environ.get("REQUEST_METHOD") != "POST":
        return json_response(start_response, {"error": "Method tidak didukung."}, status="405 Method Not Allowed")

    payload = read_json_body(environ)
    username = (payload.get("username") or "").strip().lower()
    password = payload.get("password") or ""
    user = USERS.get(username)

    if not user or user["password"] != password:
        return json_response(
            start_response,
            {"error": "Username atau password salah."},
            status="401 Unauthorized",
        )

    return json_response(
        start_response,
        {
            "name": user["name"],
            "role": user["role"],
            "pages": user["pages"],
            "username": username,
        },
    )
