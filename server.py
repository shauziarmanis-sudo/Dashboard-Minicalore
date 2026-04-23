from __future__ import annotations

import json
import mimetypes
import os
import random
import threading
import uuid
from calendar import monthrange
from datetime import date, datetime, time, timedelta, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from dashboard_store import current_source_mode, load_filter_options, load_sync_logs, load_transactions, query_kpi_summary, trigger_sync


ROOT_DIR = Path(__file__).resolve().parent
STATIC_DIR = ROOT_DIR / "static"
APP_TIMEZONE = timezone(timedelta(hours=7))
_ref_env = os.getenv("DASHBOARD_REFERENCE_DATE")
REFERENCE_DATE = date.fromisoformat(_ref_env) if _ref_env else date.today()

CHANNELS = ["GoFood", "GrabFood", "ShopeeFood"]
BRANCHES = [
    "Jakarta Pusat",
    "Kelapa Gading",
    "Bandung Dago",
    "Surabaya Barat",
    "BSD Serpong",
]
BRANDS = ["Minicalore", "Ayam Bakar Nusantara", "Sate Rempah"]
VVA_PUSAT_BRANCHES = [
    "Alam Sutera", "Bintaro", "Blok A", "BSD Junction", "Cengkareng",
    "Gading Serpong", "Galaxy Bekasi", "Greenlake", "Jatinegara",
    "Jembatan Gambang 2", "Kalibata", "Karawaci", "Kelapa Gading", "Kemang",
    "Kuningan", "Meruya", "Pepero Pizza Bintaro", "Pepero Pizza Blok A",
    "Pepero Pizza Gading Serpong", "Pepero Pizza Graha Vortexa",
    "Pepero Pizza Karawaci", "Pepero Pizza Kemang", "Pepero Pizza Meruya",
    "Pepero Pizza PIK", "Pepero Pizza Sunter", "Pepero Pizza Tebet",
    "PIK", "Rawasari", "Sunter", "Tanjung Duren", "Tebet",
]
VVA_CABANG_BRANCHES = [
    "BDG - Cipaganti", "SBY - Darmo", "SBY - Galaxy",
    "SBY - Gayungan", "SBY - Tunjungan",
]
CHANNEL_COLORS = {
    "GoFood": "#2f8f52",
    "GrabFood": "#17583d",
    "ShopeeFood": "#ec7a27",
}
USERS = {
    "owner": {
        "name": "Nadya Owner",
        "password": "minicalore123",
        "role": "executive",
        "pages": ["overview", "trend", "brand", "branch", "platform", "reconciliation"],
    },
    "finance": {
        "name": "Dimas Finance",
        "password": "minicalore123",
        "role": "finance",
        "pages": ["reconciliation"],
    },
    "marketing": {
        "name": "Rani Marketing",
        "password": "minicalore123",
        "role": "marketing",
        "pages": ["overview", "trend", "brand", "platform"],
    },
    "ops": {
        "name": "Bagas Operations",
        "password": "minicalore123",
        "role": "operations",
        "pages": ["overview", "trend", "branch"],
    },
}
BRANCH_WEIGHTS = {
    "Jakarta Pusat": 1.28,
    "Kelapa Gading": 1.14,
    "Bandung Dago": 0.94,
    "Surabaya Barat": 1.02,
    "BSD Serpong": 0.88,
}
BRAND_WEIGHTS = {
    "Minicalore": 1.18,
    "Ayam Bakar Nusantara": 1.0,
    "Sate Rempah": 0.82,
}
CHANNEL_WEIGHTS = {
    "GoFood": 1.0,
    "GrabFood": 0.92,
    "ShopeeFood": 0.86,
}


def _scheduler_loop():
    """Background thread: jalankan sync otomatis setiap hari jam 12:00 WIB."""
    import time as _time
    from dashboard_store import current_source_mode, trigger_sync

    def _sample_sync_noop(triggered_by):
        return {"status": "SKIPPED", "triggered_by": triggered_by}

    while True:
        now = datetime.now(APP_TIMEZONE)
        target_today = now.replace(hour=12, minute=0, second=0, microsecond=0)
        if now >= target_today:
            target = target_today + timedelta(days=1)
        else:
            target = target_today

        wait_seconds = (target - now).total_seconds()
        print(
            f"[scheduler] Sync berikutnya dijadwalkan pada {target.isoformat()} "
            f"(dalam {wait_seconds / 3600:.1f} jam)"
        )
        _time.sleep(wait_seconds)

        try:
            if current_source_mode() == "postgres":
                result = trigger_sync("CRON", _sample_sync_noop)
                print(
                    f"[scheduler] Sync selesai: {result.get('status')} "
                    f"— {result.get('rows_upserted', 0)} baris di-upsert"
                )
            else:
                print("[scheduler] Mode sample, sync dilewati.")
        except Exception as exc:  # noqa: BLE001
            print(f"[scheduler] Sync gagal: {exc}")

        _time.sleep(61)


def to_rupiah(value: float | int | None) -> float:
    return round(float(value or 0), 2)


def safe_sum(records: list[dict], key: str) -> float:
    return to_rupiah(sum(item[key] for item in records if item.get(key) is not None))


def percent(numerator: float, denominator: float) -> float | None:
    if not denominator:
        return None
    return round((numerator / denominator) * 100, 2)


def change_rate(current: float, previous: float) -> float | None:
    if previous == 0:
        return None
    return round(((current - previous) / previous) * 100, 2)


def combine_date(dt: date, hour: int = 12, minute: int = 0) -> str:
    return datetime.combine(dt, time(hour=hour, minute=minute), tzinfo=APP_TIMEZONE).isoformat()


def build_transactions() -> list[dict]:
    rng = random.Random(24)
    start_date = REFERENCE_DATE - timedelta(days=89)
    rows: list[dict] = []

    for offset in range((REFERENCE_DATE - start_date).days + 1):
        tx_date = start_date + timedelta(days=offset)
        weekend_factor = 1.16 if tx_date.weekday() >= 4 else 0.98
        monthly_factor = 0.95 + (tx_date.day / monthrange(tx_date.year, tx_date.month)[1]) * 0.12
        wave_factor = 0.96 + ((offset % 14) / 14) * 0.08

        for branch in BRANCHES:
            for brand in BRANDS:
                for channel in CHANNELS:
                    base_sales = (
                        485_000
                        * BRANCH_WEIGHTS[branch]
                        * BRAND_WEIGHTS[brand]
                        * CHANNEL_WEIGHTS[channel]
                        * weekend_factor
                        * monthly_factor
                        * wave_factor
                    )
                    noise = rng.uniform(0.92, 1.09)
                    penjualan = to_rupiah(base_sales * noise)

                    potongan_rate = 0.09 + rng.uniform(0.02, 0.07)
                    if channel == "ShopeeFood":
                        potongan_rate += 0.01
                    harga_coret_rate = 0.018 + rng.uniform(0.004, 0.02)
                    ads_rate = 0.032 + rng.uniform(0.012, 0.038)
                    if channel == "GrabFood":
                        ads_rate += 0.01

                    potongan = to_rupiah(penjualan * potongan_rate)
                    harga_coret = to_rupiah(penjualan * harga_coret_rate)
                    ads = to_rupiah(penjualan * ads_rate)
                    terima = to_rupiah(penjualan - potongan - harga_coret - ads)

                    uang_masuk: float | None
                    selisih: float | None
                    if rng.random() < 0.07:
                        uang_masuk = None
                        selisih = None
                    else:
                        gap_factor = rng.uniform(-0.014, 0.045)
                        uang_masuk = to_rupiah(max(0, terima * (1 - gap_factor)))
                        selisih = to_rupiah(terima - uang_masuk)

                    batch_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"{tx_date}-{branch}-{brand}-{channel}"))
                    channel_code = channel[:2].upper()
                    branch_code = "".join(part[0] for part in branch.split())[:3].upper()
                    brand_code = "".join(part[0] for part in brand.split())[:3].upper()

                    rows.append(
                        {
                            "tanggal": tx_date.isoformat(),
                            "cabang": branch,
                            "channel": channel,
                            "brand": brand,
                            "nama_akun": f"{branch} | {channel} | {brand}",
                            "penjualan": penjualan,
                            "potongan": potongan,
                            "harga_coret": harga_coret,
                            "ads": ads,
                            "terima": terima,
                            "uang_masuk": uang_masuk,
                            "selisih": selisih,
                            "kode_mutasi": f"{channel_code}-{branch_code}-{brand_code}-{tx_date.strftime('%m%d')}",
                            "created_at": combine_date(tx_date, 12, 0),
                            "updated_at": combine_date(tx_date, 12, 12),
                            "sync_batch_id": batch_id,
                        }
                    )
    return rows


def build_sync_logs() -> list[dict]:
    logs: list[dict] = []
    total_rows = len(TRANSACTIONS)
    for days_ago in range(10):
        sync_date = REFERENCE_DATE - timedelta(days=days_ago)
        sync_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"sync-{sync_date.isoformat()}"))
        rows_failed = 0 if days_ago != 6 else 3
        status = "SUCCESS" if rows_failed == 0 else "PARTIAL"
        logs.append(
            {
                "sync_id": sync_id,
                "started_at": combine_date(sync_date, 12, 0),
                "finished_at": combine_date(sync_date, 12, 3),
                "status": status,
                "rows_read": total_rows,
                "rows_upserted": total_rows - rows_failed,
                "rows_failed": rows_failed,
                "error_message": "" if rows_failed == 0 else "3 baris dilewati karena kolom channel tidak valid.",
                "triggered_by": "CRON",
            }
        )
    return logs


def totals(records: list[dict]) -> dict:
    gmv = safe_sum(records, "penjualan")
    potongan = safe_sum(records, "potongan")
    harga_coret = safe_sum(records, "harga_coret")
    ads = safe_sum(records, "ads")
    nett_gmv = safe_sum(records, "terima")
    cash_in = safe_sum(records, "uang_masuk")
    selisih = safe_sum(records, "selisih")
    return {
        "gmv": gmv,
        "potongan": potongan,
        "diskon": harga_coret,
        "harga_coret": harga_coret,
        "ads": ads,
        "nett_gmv": nett_gmv,
        "cash_in": cash_in,
        "selisih": selisih,
        "ads_efficiency": percent(ads, gmv),
        "discount_rate": percent(harga_coret, gmv),
        "net_margin": percent(nett_gmv, gmv),
        "collection_rate": percent(cash_in, nett_gmv),
    }


def parse_multi(params: dict, key: str, universe: list[str]) -> list[str]:
    raw_values = params.get(key, [])
    selected: list[str] = []
    for raw in raw_values:
        selected.extend([part.strip() for part in raw.split(",") if part.strip()])
    valid = [value for value in selected if value in universe]
    return valid or list(universe)


def filter_universes() -> dict:
    return load_filter_options(
        {
            "cabang": BRANCHES,
            "brand": BRANDS,
            "channel": CHANNELS,
        }
    )


def parse_filters(params: dict) -> dict:
    default_start = REFERENCE_DATE.replace(day=1)
    start = date.fromisoformat(params.get("start", [default_start.isoformat()])[0])
    end = date.fromisoformat(params.get("end", [REFERENCE_DATE.isoformat()])[0])
    if start > end:
        start, end = end, start
    universes = filter_universes()
    return {
        "start": start,
        "end": end,
        "cabang": parse_multi(params, "cabang", universes["cabang"]),
        "brand": parse_multi(params, "brand", universes["brand"]),
        "channel": parse_multi(params, "channel", universes["channel"]),
    }


def apply_filters(records: list[dict], filters: dict) -> list[dict]:
    return [
        item
        for item in records
        if filters["start"].isoformat() <= item["tanggal"] <= filters["end"].isoformat()
        and item["cabang"] in filters["cabang"]
        and item["brand"] in filters["brand"]
        and item["channel"] in filters["channel"]
    ]


def sample_records(filters: dict) -> list[dict]:
    return apply_filters(TRANSACTIONS, filters)


def previous_period_records(filters: dict) -> list[dict]:
    days = (filters["end"] - filters["start"]).days + 1
    previous_end = filters["start"] - timedelta(days=1)
    previous_start = previous_end - timedelta(days=days - 1)
    previous_filters = {
        **filters,
        "start": previous_start,
        "end": previous_end,
    }
    return load_transactions(previous_filters, sample_records)


def compute_vva_summary(records: list[dict], branch_list: list[str], previous_records: list[dict], total_gmv: float) -> dict:
    """
    Hitung GMV total untuk subset cabang VVA.
    Matching case-insensitive, strip whitespace.
    """
    branch_set = {branch.strip().lower() for branch in branch_list}

    current = sum(
        item["penjualan"]
        for item in records
        if item.get("cabang", "").strip().lower() in branch_set
    )
    previous = sum(
        item["penjualan"]
        for item in previous_records
        if item.get("cabang", "").strip().lower() in branch_set
    )

    return {
        "gmv": to_rupiah(current),
        "contribution": percent(current, total_gmv),
        "delta": change_rate(current, previous),
    }


def aggregate_by_key(records: list[dict], key: str) -> list[dict]:
    bucket: dict[str, dict] = {}
    for item in records:
        group = bucket.setdefault(
            item[key],
            {
                key: item[key],
                "gmv": 0.0,
                "nett_gmv": 0.0,
                "ads": 0.0,
                "diskon": 0.0,
                "cash_in": 0.0,
                "selisih": 0.0,
            },
        )
        group["gmv"] += item["penjualan"]
        group["nett_gmv"] += item["terima"]
        group["ads"] += item["ads"]
        group["diskon"] += item["harga_coret"]
        if item["uang_masuk"] is not None:
            group["cash_in"] += item["uang_masuk"]
        if item["selisih"] is not None:
            group["selisih"] += item["selisih"]

    result = list(bucket.values())
    for item in result:
        for metric in ("gmv", "nett_gmv", "ads", "diskon", "cash_in", "selisih"):
            item[metric] = to_rupiah(item[metric])
    result.sort(key=lambda row: row["gmv"], reverse=True)
    return result


def month_to_date_records(filters: dict) -> list[dict]:
    target_end = filters["end"]
    month_start = target_end.replace(day=1)
    scoped = {
        **filters,
        "start": month_start,
        "end": target_end,
    }
    return load_transactions(scoped, sample_records)


def build_kpi_payload(filters: dict) -> dict:
    if current_source_mode() == "postgres":
        sql_payload = query_kpi_summary(filters)
        if sql_payload is not None:
            return sql_payload

    current_records = load_transactions(filters, sample_records)
    current_totals = totals(current_records)
    previous_records = previous_period_records(filters)
    previous_totals = totals(previous_records)
    month_records = month_to_date_records(filters)
    month_totals = totals(month_records)
    month_days = monthrange(filters["end"].year, filters["end"].month)[1]
    days_elapsed = filters["end"].day
    run_rate = to_rupiah((month_totals["gmv"] / days_elapsed) * month_days) if days_elapsed else 0

    branch_rows = aggregate_by_key(current_records, "cabang")
    brand_rows = aggregate_by_key(current_records, "brand")
    channel_rows = aggregate_by_key(current_records, "channel")
    total_gmv = current_totals["gmv"]
    vva_pusat = compute_vva_summary(current_records, VVA_PUSAT_BRANCHES, previous_records, total_gmv)
    vva_cabang = compute_vva_summary(current_records, VVA_CABANG_BRANCHES, previous_records, total_gmv)

    cards = [
        {"key": "gmv", "label": "GMV", "value": current_totals["gmv"], "delta": change_rate(current_totals["gmv"], previous_totals["gmv"]), "accent": "forest"},
        {"key": "nett_gmv", "label": "Nett GMV", "value": current_totals["nett_gmv"], "delta": change_rate(current_totals["nett_gmv"], previous_totals["nett_gmv"]), "accent": "sage"},
        {"key": "ads", "label": "Ads Spend", "value": current_totals["ads"], "delta": change_rate(current_totals["ads"], previous_totals["ads"]), "accent": "amber"},
        {"key": "diskon", "label": "Total Diskon", "value": current_totals["diskon"], "delta": change_rate(current_totals["diskon"], previous_totals["diskon"]), "accent": "berry"},
        {"key": "cash_in", "label": "Cash In", "value": current_totals["cash_in"], "delta": change_rate(current_totals["cash_in"], previous_totals["cash_in"]), "accent": "sky"},
        {"key": "selisih", "label": "Selisih", "value": current_totals["selisih"], "delta": change_rate(current_totals["selisih"], previous_totals["selisih"]), "accent": "fire"},
        {"key": "run_rate", "label": "Run Rate Bulanan", "value": run_rate, "delta": None, "accent": "charcoal"},
    ]

    return {
        "period": {
            "start": filters["start"].isoformat(),
            "end": filters["end"].isoformat(),
        },
        "totals": current_totals,
        "derived": {
            "run_rate": run_rate,
            "ads_efficiency": current_totals["ads_efficiency"],
            "discount_rate": current_totals["discount_rate"],
            "net_margin": current_totals["net_margin"],
            "collection_rate": current_totals["collection_rate"],
        },
        "cards": cards,
        "highlights": {
            "top_branch": branch_rows[0] if branch_rows else None,
            "top_brand": brand_rows[0] if brand_rows else None,
            "top_channel": channel_rows[0] if channel_rows else None,
            "largest_gap_branch": max(branch_rows, key=lambda row: abs(row["selisih"]), default=None),
        },
        "vva": {
            "pusat": vva_pusat,
            "cabang": vva_cabang,
        },
        "source_mode": current_source_mode(),
    }


def build_trend_payload(filters: dict) -> dict:
    current_records = load_transactions(filters, sample_records)
    by_day: dict[str, dict] = {}
    pointer = filters["start"]
    while pointer <= filters["end"]:
        by_day[pointer.isoformat()] = {"date": pointer.isoformat(), "gmv": 0.0, "nett_gmv": 0.0, "ads": 0.0}
        pointer += timedelta(days=1)

    for item in current_records:
        day = by_day[item["tanggal"]]
        day["gmv"] += item["penjualan"]
        day["nett_gmv"] += item["terima"]
        day["ads"] += item["ads"]

    points = []
    for day in by_day.values():
        points.append(
            {
                "date": day["date"],
                "gmv": to_rupiah(day["gmv"]),
                "nett_gmv": to_rupiah(day["nett_gmv"]),
                "ads": to_rupiah(day["ads"]),
            }
        )
    return {
        "points": points,
        "averages": {
            "gmv": to_rupiah(sum(day["gmv"] for day in points) / len(points)) if points else 0,
            "nett_gmv": to_rupiah(sum(day["nett_gmv"] for day in points) / len(points)) if points else 0,
            "ads": to_rupiah(sum(day["ads"] for day in points) / len(points)) if points else 0,
        },
    }


def build_brand_payload(filters: dict) -> dict:
    current_records = load_transactions(filters, sample_records)
    rows = aggregate_by_key(current_records, "brand")
    total_gmv = safe_sum(current_records, "penjualan")
    for row in rows:
        row["contribution"] = percent(row["gmv"], total_gmv) or 0
    return {"rows": rows, "total_gmv": total_gmv}


def build_branch_payload(filters: dict) -> dict:
    current_records = load_transactions(filters, sample_records)
    rows = aggregate_by_key(current_records, "cabang")
    gap_rows = sorted(rows, key=lambda row: abs(row["selisih"]), reverse=True)
    return {
        "top": rows[:5],
        "bottom": list(reversed(rows[-5:])),
        "gaps": gap_rows[:5],
    }


def build_platform_payload(filters: dict) -> dict:
    current_records = load_transactions(filters, sample_records)
    rows = aggregate_by_key(current_records, "channel")
    total_gmv = safe_sum(current_records, "penjualan")
    for row in rows:
        row["contribution"] = percent(row["gmv"], total_gmv) or 0
        row["color"] = CHANNEL_COLORS[row["channel"]]
    return {"rows": rows}


def build_reconciliation_payload(filters: dict, only_difference: bool) -> dict:
    current_records = load_transactions(filters, sample_records)
    rows = []
    for item in current_records:
        if only_difference and (item["selisih"] is None or abs(item["selisih"]) < 0.01):
            continue
        rows.append(
            {
                "tanggal": item["tanggal"],
                "cabang": item["cabang"],
                "channel": item["channel"],
                "brand": item["brand"],
                "terima": item["terima"],
                "uang_masuk": item["uang_masuk"],
                "selisih": item["selisih"],
                "kode_mutasi": item["kode_mutasi"],
            }
        )
    rows.sort(
        key=lambda item: (
            item["tanggal"],
            abs(item["selisih"] or 0),
        ),
        reverse=True,
    )
    return {
        "summary": {
            "terima": safe_sum(current_records, "terima"),
            "uang_masuk": safe_sum(current_records, "uang_masuk"),
            "selisih": safe_sum(current_records, "selisih"),
            "rows": len(rows),
        },
        "rows": rows[:250],
    }


TRANSACTIONS = build_transactions()
SYNC_LOGS = build_sync_logs()


class DashboardHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC_DIR), **kwargs)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.handle_api_get(parsed)
            return

        if parsed.path == "/":
            self.path = "/index.html"

        target = (STATIC_DIR / parsed.path.lstrip("/")).resolve()
        if parsed.path != "/" and (not target.exists() or not target.is_file()):
            self.path = "/index.html"
        super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/login":
            self.handle_login()
            return
        if parsed.path == "/api/sync/trigger":
            self.handle_manual_sync()
            return
        self.send_json({"error": "Endpoint tidak ditemukan."}, status=404)

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def guess_type(self, path: str) -> str:
        if path.endswith(".js"):
            return "text/javascript; charset=utf-8"
        if path.endswith(".css"):
            return "text/css; charset=utf-8"
        return mimetypes.guess_type(path)[0] or "application/octet-stream"

    def read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length else b"{}"
        if not raw:
            return {}
        return json.loads(raw.decode("utf-8"))

    def handle_api_get(self, parsed) -> None:
        params = parse_qs(parsed.query)
        filters = parse_filters(params)

        routes = {
            "/api/filters": self.handle_filters,
            "/api/kpi": lambda: self.send_json(build_kpi_payload(filters)),
            "/api/trend/daily": lambda: self.send_json(build_trend_payload(filters)),
            "/api/brand": lambda: self.send_json(build_brand_payload(filters)),
            "/api/cabang": lambda: self.send_json(build_branch_payload(filters)),
            "/api/platform": lambda: self.send_json(build_platform_payload(filters)),
            "/api/rekonsiliasi": lambda: self.send_json(
                build_reconciliation_payload(filters, params.get("only_difference", ["false"])[0] == "true")
            ),
            "/api/sync/cron": lambda: self.send_json(self._handle_cron_sync()),
            "/api/sync/logs": lambda: self.send_json({"logs": load_sync_logs(8, SYNC_LOGS), "source_mode": current_source_mode()}),
        }
        handler = routes.get(parsed.path)
        if handler is None:
            self.send_json({"error": "Endpoint tidak ditemukan."}, status=404)
            return
        handler()

    def handle_filters(self) -> None:
        self.send_json(
            {
                **filter_universes(),
                "defaults": {
                    "start": REFERENCE_DATE.replace(day=1).isoformat(),
                    "end": REFERENCE_DATE.isoformat(),
                },
                "source_mode": current_source_mode(),
            }
        )

    def handle_login(self) -> None:
        payload = self.read_json()
        username = (payload.get("username") or "").strip().lower()
        password = payload.get("password") or ""
        user = USERS.get(username)

        if not user or user["password"] != password:
            self.send_json({"error": "Username atau password salah."}, status=401)
            return

        self.send_json(
            {
                "name": user["name"],
                "role": user["role"],
                "pages": user["pages"],
                "username": username,
            }
        )

    def handle_manual_sync(self) -> None:
        try:
            latest_log = trigger_sync("MANUAL", self.manual_sample_sync)
        except Exception as exc:  # noqa: BLE001
            self.send_json(
                {"error": f"Sync gagal dijalankan: {exc}", "source_mode": current_source_mode()},
                status=503,
            )
            return
        self.send_json({"message": "Sync manual berhasil dipicu.", "log": latest_log, "source_mode": current_source_mode()})

    def _handle_cron_sync(self) -> dict:
        def noop(triggered_by):
            return {"status": "SKIPPED_SAMPLE_MODE", "triggered_by": triggered_by}

        try:
            return trigger_sync("CRON", noop)
        except Exception as exc:  # noqa: BLE001
            return {"error": str(exc)}

    def manual_sample_sync(self, triggered_by: str) -> dict:
        now = datetime.now(APP_TIMEZONE)
        sync_id = str(uuid.uuid4())
        rows_read = len(TRANSACTIONS)
        rows_failed = 0
        latest_log = {
            "sync_id": sync_id,
            "started_at": now.isoformat(),
            "finished_at": (now + timedelta(seconds=95)).isoformat(),
            "status": "SUCCESS",
            "rows_read": rows_read,
            "rows_upserted": rows_read,
            "rows_failed": rows_failed,
            "error_message": "",
            "triggered_by": triggered_by,
        }
        SYNC_LOGS.insert(0, latest_log)
        del SYNC_LOGS[12:]
        return latest_log

    def send_json(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def run() -> None:
    port = int(os.getenv("PORT", "8000"))
    scheduler_thread = threading.Thread(target=_scheduler_loop, daemon=True)
    scheduler_thread.start()
    server = ThreadingHTTPServer(("127.0.0.1", port), DashboardHandler)
    print(f"Dashboard server berjalan di http://127.0.0.1:{port}")
    server.serve_forever()


if __name__ == "__main__":
    run()
