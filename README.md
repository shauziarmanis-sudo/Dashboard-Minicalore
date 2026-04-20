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
- Dependency Python deploy ada di `requirements.txt`

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

- App sekarang mendukung dua mode data:
  - `sample` jika kredensial belum diisi
  - `postgres` jika `DATABASE_URL` dan konfigurasi Google Sheets sudah tersedia
- Endpoint sync manual akan menarik data Google Sheets, menghitung ulang `terima` dan `selisih`, lalu UPSERT ke PostgreSQL saat mode aktual aktif.
- Tanggal referensi demo default adalah `2026-04-20` agar sesuai PRD. Jika perlu, bisa diubah melalui environment variable `DASHBOARD_REFERENCE_DATE`.

## Konfigurasi data aktual

Isi environment variable berikut di local atau Vercel:

- `DATABASE_URL`
- `GOOGLE_SHEETS_CSV_URL`

Atau jika sheet private:

- `DATABASE_URL`
- `GOOGLE_SHEETS_SPREADSHEET_ID`
- `GOOGLE_SHEETS_WORKSHEET_NAME`
- `GOOGLE_SERVICE_ACCOUNT_JSON`

Catatan:

- Jika memakai service account, spreadsheet harus dibagikan ke email service account.
- Jika memakai `GOOGLE_SHEETS_CSV_URL`, sheet harus bisa diakses oleh URL export CSV tersebut.

## Langkah lanjutan yang disarankan

1. Isi environment variable aktual di Vercel dan local.
2. Jalankan sync manual pertama untuk mengisi tabel `transaksi_harian`.
3. Tambahkan scheduler harian pukul 12:00 WIB untuk endpoint sync.
4. Tambahkan autentikasi produksi dan RBAC server-side.
