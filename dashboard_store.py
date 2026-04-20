from __future__ import annotations

import csv
import importlib
import io
import json
import os
import re
import urllib.parse
import urllib.request
import uuid
from contextlib import closing
from datetime import date, datetime, timedelta

from pathlib import Path

SYNC_LOG_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS sync_log (
    sync_id UUID PRIMARY KEY,
    started_at TIMESTAMPTZ NOT NULL,
    finished_at TIMESTAMPTZ,
    status VARCHAR(20) NOT NULL,
    rows_read INTEGER NOT NULL DEFAULT 0,
    rows_upserted INTEGER NOT NULL DEFAULT 0,
    rows_failed INTEGER NOT NULL DEFAULT 0,
    error_message TEXT DEFAULT '',
    triggered_by VARCHAR(100) NOT NULL DEFAULT 'CRON'
);
"""


TRANSACTION_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS transaksi_harian (
    tanggal DATE NOT NULL,
    cabang VARCHAR(100) NOT NULL,
    channel VARCHAR(50) NOT NULL,
    brand VARCHAR(100) NOT NULL,
    nama_akun VARCHAR(255) NOT NULL,
    penjualan NUMERIC(15, 2) NOT NULL DEFAULT 0,
    potongan NUMERIC(15, 2) NOT NULL DEFAULT 0,
    harga_coret NUMERIC(15, 2) NOT NULL DEFAULT 0,
    ads NUMERIC(15, 2) NOT NULL DEFAULT 0,
    terima NUMERIC(15, 2) NOT NULL DEFAULT 0,
    uang_masuk NUMERIC(15, 2),
    selisih NUMERIC(15, 2),
    kode_mutasi VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sync_batch_id UUID NOT NULL,
    PRIMARY KEY (tanggal, cabang, channel, brand)
);
"""


UPSERT_SQL = """
INSERT INTO transaksi_harian (
    tanggal,
    cabang,
    channel,
    brand,
    nama_akun,
    penjualan,
    potongan,
    harga_coret,
    ads,
    terima,
    uang_masuk,
    selisih,
    kode_mutasi,
    created_at,
    updated_at,
    sync_batch_id
) VALUES (
    %(tanggal)s,
    %(cabang)s,
    %(channel)s,
    %(brand)s,
    %(nama_akun)s,
    %(penjualan)s,
    %(potongan)s,
    %(harga_coret)s,
    %(ads)s,
    %(terima)s,
    %(uang_masuk)s,
    %(selisih)s,
    %(kode_mutasi)s,
    %(created_at)s,
    %(updated_at)s,
    %(sync_batch_id)s
)
ON CONFLICT (tanggal, cabang, channel, brand)
DO UPDATE SET
    nama_akun = EXCLUDED.nama_akun,
    penjualan = EXCLUDED.penjualan,
    potongan = EXCLUDED.potongan,
    harga_coret = EXCLUDED.harga_coret,
    ads = EXCLUDED.ads,
    terima = EXCLUDED.terima,
    uang_masuk = EXCLUDED.uang_masuk,
    selisih = EXCLUDED.selisih,
    kode_mutasi = EXCLUDED.kode_mutasi,
    updated_at = EXCLUDED.updated_at,
    sync_batch_id = EXCLUDED.sync_batch_id;
"""


HEADER_ALIASES = {
    "tanggal": ["tanggal", "tgl", "date"],
    "cabang": ["cabang", "branch", "outlet"],
    "channel": ["channel", "platform", "kanal"],
    "brand": ["brand", "merek"],
    "nama_akun": ["namaakun", "nama_akun", "nama akun", "accountname", "labelakun"],
    "penjualan": ["penjualan", "sales", "gmv", "grosssales", "gross sale"],
    "potongan": ["potongan", "diskon", "discount"],
    "harga_coret": ["hargacoret", "harga_coret", "harga coret", "strikeprice", "markdown"],
    "ads": ["ads", "adsspend", "iklan"],
    "uang_masuk": ["uangmasuk", "uang_masuk", "uang masuk", "cashin", "cash in"],
    "kode_mutasi": ["kodemutasi", "kode_mutasi", "kode mutasi", "mutationcode", "reference"],
}


CHANNEL_LOOKUP = {
    "gofood": "GoFood",
    "grabfood": "GrabFood",
    "shopeefood": "ShopeeFood",
}

ENV_FILES = [".env.local", ".env"]


def load_local_env():
    root = Path(__file__).resolve().parent
    for filename in ENV_FILES:
        env_path = root / filename
        if not env_path.exists():
            continue
        for line in env_path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            key, value = stripped.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            os.environ.setdefault(key, value)


load_local_env()


def current_source_mode() -> str:
    if has_actual_data_config():
        return "postgres"
    return "sample"


def has_actual_data_config() -> bool:
    return bool(database_url()) and bool(sheet_source_available())


def database_url() -> str | None:
    explicit = os.getenv("DATABASE_URL")
    if explicit:
        return explicit

    host = os.getenv("PGHOST")
    user = os.getenv("PGUSER")
    password = os.getenv("PGPASSWORD")
    name = os.getenv("PGDATABASE")
    port = os.getenv("PGPORT", "5432")
    if not all([host, user, password, name]):
        return None

    quoted_password = urllib.parse.quote(password)
    return f"postgresql://{user}:{quoted_password}@{host}:{port}/{name}"


def database_url_with_timeout(timeout_seconds: int = 3) -> str | None:
    base_url = database_url()
    if not base_url:
        return None
    separator = "&" if "?" in base_url else "?"
    return f"{base_url}{separator}connect_timeout={timeout_seconds}"


def sheet_source_available() -> bool:
    return bool(os.getenv("GOOGLE_SHEETS_CSV_URL") or os.getenv("GOOGLE_SHEETS_SPREADSHEET_ID"))


def load_transactions(filters: dict, sample_loader):
    if current_source_mode() == "postgres":
        records = query_transactions(filters)
        if records is not None:
            return records
    return sample_loader(filters)


def load_filter_options(defaults: dict):
    if current_source_mode() == "postgres":
        options = query_filter_options()
        if options is not None and any(options.values()):
            return options
    return defaults


def load_sync_logs(limit: int, fallback_logs: list[dict]):
    if current_source_mode() == "postgres":
        logs = query_sync_logs(limit)
        if logs is not None and logs:
            return logs
    return fallback_logs[:limit]


def trigger_sync(triggered_by: str, fallback_sync):
    if current_source_mode() == "postgres":
        return sync_google_sheet_to_postgres(triggered_by)
    return fallback_sync(triggered_by)


def sync_google_sheet_to_postgres(triggered_by: str):
    module = load_psycopg()
    if module is None:
        raise RuntimeError("Dependency PostgreSQL belum terpasang. Tambahkan psycopg untuk mode data aktual.")

    started_at = datetime.utcnow()
    sync_id = str(uuid.uuid4())
    raw_rows = fetch_sheet_rows()
    rows_read = len(raw_rows)
    batch_id = str(uuid.uuid4())
    upserted = 0
    failed = 0
    last_error = ""

    with closing(module.connect(database_url_with_timeout())) as connection:
        ensure_schema(connection)
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO sync_log (sync_id, started_at, status, rows_read, rows_upserted, rows_failed, error_message, triggered_by)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (sync_id, started_at, "RUNNING", rows_read, 0, 0, "", triggered_by),
            )

            for row in raw_rows:
                try:
                    transformed = transform_sheet_row(row, batch_id)
                    cursor.execute(UPSERT_SQL, transformed)
                    upserted += 1
                except Exception as exc:  # noqa: BLE001
                    failed += 1
                    last_error = str(exc)

            status = "SUCCESS" if failed == 0 else "PARTIAL"
            finished_at = datetime.utcnow()
            cursor.execute(
                """
                UPDATE sync_log
                SET finished_at = %s,
                    status = %s,
                    rows_upserted = %s,
                    rows_failed = %s,
                    error_message = %s
                WHERE sync_id = %s
                """,
                (finished_at, status, upserted, failed, last_error, sync_id),
            )
        connection.commit()

    return {
        "sync_id": sync_id,
        "started_at": started_at.isoformat(),
        "finished_at": finished_at.isoformat(),
        "status": status,
        "rows_read": rows_read,
        "rows_upserted": upserted,
        "rows_failed": failed,
        "error_message": last_error,
        "triggered_by": triggered_by,
    }


def ensure_schema(connection):
    with connection.cursor() as cursor:
        cursor.execute(TRANSACTION_TABLE_SQL)
        cursor.execute(SYNC_LOG_TABLE_SQL)
    connection.commit()


def query_transactions(filters: dict):
    module = load_psycopg()
    if module is None:
        return []

    query = """
        SELECT
            tanggal,
            cabang,
            channel,
            brand,
            nama_akun,
            penjualan,
            potongan,
            harga_coret,
            ads,
            terima,
            uang_masuk,
            selisih,
            kode_mutasi,
            created_at,
            updated_at,
            sync_batch_id
        FROM transaksi_harian
        WHERE tanggal BETWEEN %s AND %s
          AND cabang = ANY(%s)
          AND brand = ANY(%s)
          AND channel = ANY(%s)
        ORDER BY tanggal ASC, cabang ASC, brand ASC, channel ASC
    """
    try:
        with closing(module.connect(database_url_with_timeout())) as connection:
            ensure_schema(connection)
            with connection.cursor() as cursor:
                cursor.execute(
                    query,
                    (
                        filters["start"],
                        filters["end"],
                        filters["cabang"],
                        filters["brand"],
                        filters["channel"],
                    ),
                )
                rows = cursor.fetchall()
    except Exception:  # noqa: BLE001
        return None

    result = []
    for row in rows:
        result.append(
            {
                "tanggal": row[0].isoformat(),
                "cabang": row[1],
                "channel": row[2],
                "brand": row[3],
                "nama_akun": row[4],
                "penjualan": float(row[5] or 0),
                "potongan": float(row[6] or 0),
                "harga_coret": float(row[7] or 0),
                "ads": float(row[8] or 0),
                "terima": float(row[9] or 0),
                "uang_masuk": float(row[10]) if row[10] is not None else None,
                "selisih": float(row[11]) if row[11] is not None else None,
                "kode_mutasi": row[12],
                "created_at": row[13].isoformat() if row[13] else "",
                "updated_at": row[14].isoformat() if row[14] else "",
                "sync_batch_id": str(row[15]),
            }
        )
    return result


def query_filter_options():
    module = load_psycopg()
    if module is None:
        return {"cabang": [], "brand": [], "channel": []}

    def fetch_distinct(cursor, column: str):
        cursor.execute(f"SELECT DISTINCT {column} FROM transaksi_harian ORDER BY {column} ASC")
        return [row[0] for row in cursor.fetchall() if row[0]]

    try:
        with closing(module.connect(database_url_with_timeout())) as connection:
            ensure_schema(connection)
            with connection.cursor() as cursor:
                cabang = fetch_distinct(cursor, "cabang")
                brand = fetch_distinct(cursor, "brand")
                channel = fetch_distinct(cursor, "channel")
    except Exception:  # noqa: BLE001
        return None
    return {"cabang": cabang, "brand": brand, "channel": channel}


def query_sync_logs(limit: int):
    module = load_psycopg()
    if module is None:
        return []

    try:
        with closing(module.connect(database_url_with_timeout())) as connection:
            ensure_schema(connection)
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT sync_id, started_at, finished_at, status, rows_read, rows_upserted, rows_failed, error_message, triggered_by
                    FROM sync_log
                    ORDER BY started_at DESC
                    LIMIT %s
                    """,
                    (limit,),
                )
                rows = cursor.fetchall()
    except Exception:  # noqa: BLE001
        return None

    return [
        {
            "sync_id": str(row[0]),
            "started_at": row[1].isoformat() if row[1] else "",
            "finished_at": row[2].isoformat() if row[2] else "",
            "status": row[3],
            "rows_read": row[4],
            "rows_upserted": row[5],
            "rows_failed": row[6],
            "error_message": row[7] or "",
            "triggered_by": row[8],
        }
        for row in rows
    ]


def fetch_sheet_rows():
    csv_url = os.getenv("GOOGLE_SHEETS_CSV_URL")
    if csv_url:
        return fetch_sheet_rows_from_csv(csv_url)

    spreadsheet_id = os.getenv("GOOGLE_SHEETS_SPREADSHEET_ID")
    if spreadsheet_id:
        return fetch_sheet_rows_from_api(spreadsheet_id, os.getenv("GOOGLE_SHEETS_WORKSHEET_NAME", "Transaksi Pembayaran"))

    raise RuntimeError("Konfigurasi Google Sheets belum tersedia.")


def fetch_sheet_rows_from_csv(csv_url: str):
    with urllib.request.urlopen(csv_url) as response:
        payload = response.read().decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(payload))
    return [dict(row) for row in reader]


def fetch_sheet_rows_from_api(spreadsheet_id: str, worksheet_name: str):
    spreadsheet_id = normalize_spreadsheet_id(spreadsheet_id)
    service_account_info = load_service_account_info()
    if not service_account_info:
        raise RuntimeError("Service account Google belum dikonfigurasi.")

    credentials_module = importlib.import_module("google.oauth2.service_account")
    discovery_module = importlib.import_module("googleapiclient.discovery")
    credentials = credentials_module.Credentials.from_service_account_info(
        service_account_info,
        scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"],
    )
    service = discovery_module.build("sheets", "v4", credentials=credentials, cache_discovery=False)
    response = (
        service.spreadsheets()
        .values()
        .get(spreadsheetId=spreadsheet_id, range=worksheet_name)
        .execute()
    )

    values = response.get("values", [])
    if not values:
        return []
    headers = values[0]
    rows = []
    for raw in values[1:]:
        row = {}
        for index, header in enumerate(headers):
            row[header] = raw[index] if index < len(raw) else ""
        rows.append(row)
    return rows


def load_service_account_info():
    raw_json = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON")
    if raw_json:
        return json.loads(raw_json)

    file_path = os.getenv("GOOGLE_SERVICE_ACCOUNT_FILE")
    if file_path and os.path.exists(file_path):
        with open(file_path, "r", encoding="utf-8") as handle:
            return json.load(handle)
    return None


def normalize_spreadsheet_id(value: str):
    raw = str(value or "").strip()
    match = re.search(r"/spreadsheets/d/([a-zA-Z0-9-_]+)", raw)
    if match:
        return match.group(1)
    return raw


def load_psycopg():
    for module_name in ("psycopg", "psycopg2"):
        try:
            return importlib.import_module(module_name)
        except ImportError:
            continue
    return None


def transform_sheet_row(raw_row: dict, batch_id: str):
    normalized = map_raw_row(raw_row)
    tanggal = parse_date(normalized["tanggal"])
    cabang = normalize_text(normalized["cabang"], title_case=True)
    brand = normalize_text(normalized["brand"], title_case=True)
    channel = normalize_channel(normalized["channel"])

    penjualan = parse_number(normalized["penjualan"])
    potongan = parse_number(normalized.get("potongan"))
    harga_coret = parse_number(normalized.get("harga_coret"))
    ads = parse_number(normalized.get("ads"))
    uang_masuk = parse_number(normalized.get("uang_masuk"), nullable=True)

    terima = round(penjualan - potongan - harga_coret - ads, 2)
    selisih = round(terima - uang_masuk, 2) if uang_masuk is not None else None
    now = datetime.utcnow()
    kode_mutasi = normalize_text(normalized.get("kode_mutasi") or "", title_case=False) or None
    nama_akun = normalize_text(normalized.get("nama_akun") or f"{cabang} | {channel} | {brand}", title_case=False)

    return {
        "tanggal": tanggal,
        "cabang": cabang,
        "channel": channel,
        "brand": brand,
        "nama_akun": nama_akun,
        "penjualan": penjualan,
        "potongan": potongan,
        "harga_coret": harga_coret,
        "ads": ads,
        "terima": terima,
        "uang_masuk": uang_masuk,
        "selisih": selisih,
        "kode_mutasi": kode_mutasi,
        "created_at": now,
        "updated_at": now,
        "sync_batch_id": batch_id,
    }


def map_raw_row(raw_row: dict):
    flat = {}
    for key, value in raw_row.items():
        normalized_key = normalize_header(key)
        flat[normalized_key] = value

    mapped = {}
    for target, aliases in HEADER_ALIASES.items():
        for alias in aliases:
            alias_key = normalize_header(alias)
            if alias_key in flat:
                mapped[target] = flat[alias_key]
                break

    required = ("tanggal", "cabang", "channel", "brand", "penjualan")
    missing = [field for field in required if not mapped.get(field)]
    if missing:
        raise ValueError(f"Kolom wajib kosong atau tidak ditemukan: {', '.join(missing)}")
    return mapped


def normalize_header(value: str):
    return re.sub(r"[^a-z0-9]+", "", str(value or "").strip().lower())


def normalize_text(value: str, title_case: bool = False):
    cleaned = " ".join(str(value or "").strip().split())
    if title_case:
        return cleaned.title()
    return cleaned


def normalize_channel(value: str):
    key = normalize_header(value)
    if key not in CHANNEL_LOOKUP:
        raise ValueError(f"Channel tidak valid: {value}")
    return CHANNEL_LOOKUP[key]


def parse_date(value):
    raw = str(value or "").strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    raise ValueError(f"Format tanggal tidak dikenali: {value}")


def parse_number(value, nullable: bool = False):
    if value is None or str(value).strip() == "":
        return None if nullable else 0.0

    text = str(value).strip()
    text = text.replace("Rp", "").replace("rp", "").replace(" ", "")
    if "," in text and "." in text:
        if text.rfind(",") > text.rfind("."):
            text = text.replace(".", "").replace(",", ".")
        else:
            text = text.replace(",", "")
    elif "," in text:
        parts = text.split(",")
        if len(parts) == 2 and len(parts[-1]) in (1, 2):
            text = text.replace(".", "").replace(",", ".")
        else:
            text = text.replace(",", "")
    elif text.count(".") > 1:
        text = text.replace(".", "")

    return round(float(text), 2)
