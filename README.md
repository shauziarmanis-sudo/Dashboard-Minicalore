# Dashboard Penjualan Restoran Terpusat

Custom web app MVP yang dibuat berdasarkan PRD `PRD_Dashboard_Penjualan_Restoran.docx`.

## Yang sudah dibuat

- Dashboard 6 halaman:
  - Executive Overview
  - Tren Harian
  - Performa Brand
  - Performa Cabang
  - Performa Platform
  - Rekonsiliasi
- Global filter untuk:
  - range tanggal
  - cabang
  - brand
  - channel
- Login demo berbasis role:
  - `owner`
  - `finance`
  - `marketing`
  - `ops`
- API internal sesuai PRD:
  - `GET /api/kpi`
  - `GET /api/trend/daily`
  - `GET /api/brand`
  - `GET /api/cabang`
  - `GET /api/platform`
  - `GET /api/rekonsiliasi`
  - `GET /api/filters`
  - `GET /api/sync/logs`
  - `POST /api/sync/trigger`
- Export CSV untuk halaman rekonsiliasi
- Sample dataset yang mengikuti model data PRD, termasuk field turunan `terima` dan `selisih`

## Cara menjalankan

```bash
python server.py
```

Lalu buka:

```text
http://127.0.0.1:8000
```

## Siap deploy ke Vercel

- Frontend statis tetap berada di folder `static/`
- API untuk Vercel tersedia di folder `api/`
- Routing deploy diatur lewat `vercel.json`

Endpoint yang tersedia saat deploy tetap sama:

- `GET /api/kpi`
- `GET /api/trend/daily`
- `GET /api/brand`
- `GET /api/cabang`
- `GET /api/platform`
- `GET /api/rekonsiliasi`
- `GET /api/filters`
- `GET /api/sync/logs`
- `POST /api/login`
- `POST /api/sync/trigger`

## Kredensial demo

- `owner / minicalore123`
- `finance / minicalore123`
- `marketing / minicalore123`
- `ops / minicalore123`

## Catatan implementasi

- Data saat ini masih berupa sample in-memory agar aplikasi bisa langsung dipreview tanpa setup PostgreSQL dan Google Sheets API.
- Struktur endpoint, filter, KPI, role, dan halaman sudah disejajarkan dengan PRD sehingga tahap berikutnya tinggal mengganti source data sample dengan pipeline ETL dan database riil.
- Tanggal referensi demo default adalah `2026-04-20` agar sesuai PRD. Jika perlu, bisa diubah melalui environment variable `DASHBOARD_REFERENCE_DATE`.

## Langkah lanjutan yang disarankan

1. Ganti dataset sample di `server.py` dengan koneksi PostgreSQL.
2. Tambahkan ETL reader Google Sheets dan UPSERT harian pukul 12:00 WIB.
3. Tambahkan autentikasi produksi dan RBAC server-side.
4. Tambahkan notifikasi error sync ke email atau Slack.
