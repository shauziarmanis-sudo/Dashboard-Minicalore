import {
  buildQuery,
  deltaClass,
  downloadCsv,
  emptyState,
  escapeHtml,
  formatCurrency,
  formatDate,
  formatPercent,
  formatSignedPercent,
} from "./utils.js?v=20260421-3";
import { renderDonutChart, renderGroupedBars, renderHorizontalBars, renderTrendChart } from "./charts.js?v=20260421-3";

const pageMeta = {
  overview: {
    id: "overview-page",
    title: "Executive overview",
    subtitle: "Skor KPI utama, run rate bulanan, dan highlight performa bisnis dalam satu layar.",
    label: "Overview",
    icon: "dashboard",
    hint: "Snapshot utama bisnis",
  },
  trend: {
    id: "trend-page",
    title: "Tren harian",
    subtitle: "Pantau ritme GMV, Nett GMV, dan Ads Spend per hari pada periode terpilih.",
    label: "Tren Harian",
    icon: "monitoring",
    hint: "Gerak harian penjualan",
  },
  brand: {
    id: "brand-page",
    title: "Performa brand",
    subtitle: "Lihat kontribusi setiap brand terhadap GMV dan kualitas monetisasinya.",
    label: "Performa Brand",
    icon: "local_mall",
    hint: "Kontribusi tiap brand",
  },
  branch: {
    id: "branch-page",
    title: "Performa cabang",
    subtitle: "Bandingkan cabang terbaik, cabang terlemah, dan lokasi dengan gap rekonsiliasi terbesar.",
    label: "Performa Cabang",
    icon: "storefront",
    hint: "Ranking outlet aktif",
  },
  platform: {
    id: "platform-page",
    title: "Performa platform",
    subtitle: "Analisis komposisi GMV, Ads, dan Diskon per channel delivery utama.",
    label: "Performa Platform",
    icon: "apps",
    hint: "Analisis tiap channel",
  },
  reconciliation: {
    id: "reconciliation-page",
    title: "Rekonsiliasi",
    subtitle: "Identifikasi selisih antara terima dan uang masuk dengan detail sampai kode mutasi.",
    label: "Rekonsiliasi",
    icon: "receipt_long",
    hint: "Detail cash in dan gap",
  },
};

const state = {
  session: JSON.parse(localStorage.getItem("dashboard-session") || "null"),
  filters: {
    start: "",
    end: "",
    cabang: [],
    brand: [],
    channel: [],
  },
  filterOptions: null,
  activePage: "overview",
  onlyDifference: false,
  data: {},
};

const el = {
  loginModal: document.getElementById("login-modal"),
  loginForm: document.getElementById("login-form"),
  loginError: document.getElementById("login-error"),
  pageNav: document.getElementById("page-nav"),
  statusBanner: document.getElementById("status-banner"),
  pageTitle: document.getElementById("page-title"),
  pageSubtitle: document.getElementById("page-subtitle"),
  roleChip: document.getElementById("role-chip"),
  sessionName: document.getElementById("session-name"),
  sessionCopy: document.getElementById("session-copy"),
  syncSummary: document.getElementById("sync-summary"),
  startDate: document.getElementById("start-date"),
  endDate: document.getElementById("end-date"),
  branchOptions: document.getElementById("branch-options"),
  brandOptions: document.getElementById("brand-options"),
  channelOptions: document.getElementById("channel-options"),
  branchCount: document.getElementById("branch-count"),
  brandCount: document.getElementById("brand-count"),
  overviewPage: document.getElementById("overview-page"),
  trendPage: document.getElementById("trend-page"),
  brandPage: document.getElementById("brand-page"),
  branchPage: document.getElementById("branch-page"),
  platformPage: document.getElementById("platform-page"),
  reconciliationPage: document.getElementById("reconciliation-page"),
  syncButton: document.getElementById("sync-button"),
  logoutButton: document.getElementById("logout-button"),
  applyFilters: document.getElementById("apply-filters"),
  resetFilters: document.getElementById("reset-filters"),
};

async function apiFetch(url, options = {}) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
    },
    ...options,
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Terjadi kesalahan saat memanggil API.");
  }
  return payload;
}

function describeError(error) {
  if (!error) {
    return "Unknown error";
  }
  if (typeof error === "string") {
    return error;
  }
  return error.message || "Unknown error";
}

function reportLoadFailure(context, error) {
  const detail = describeError(error);
  console.error(`[dashboard] ${context}`, error);
  setStatus(`Gagal memuat data live: ${detail}`);
}

function setStatus(message) {
  el.statusBanner.textContent = message;
}

function persistSession(session) {
  state.session = session;
  localStorage.setItem("dashboard-session", JSON.stringify(session));
}

function clearSession() {
  state.session = null;
  localStorage.removeItem("dashboard-session");
}

function allowedPages() {
  return state.session?.pages || [];
}

function ensureActivePage() {
  const pages = allowedPages();
  if (!pages.length) {
    state.activePage = "overview";
    return;
  }
  if (!pages.includes(state.activePage)) {
    state.activePage = pages[0];
  }
}

function renderSession() {
  if (!state.session) {
    el.roleChip.textContent = "Belum login";
    el.sessionName.textContent = "Akses dashboard";
    el.sessionCopy.textContent = "Login untuk membuka halaman sesuai role.";
    return;
  }

  el.roleChip.textContent = state.session.role;
  el.sessionName.textContent = state.session.name;
  el.sessionCopy.textContent = `Akses aktif sebagai ${state.session.username}. Halaman mengikuti akses role masing-masing.`;
}

function renderPageNav() {
  const pages = allowedPages();
  el.pageNav.innerHTML = pages
    .map(
      (page) => `
        <button class="nav-pill ${state.activePage === page ? "is-active" : ""}" data-page="${page}">
          <span class="material-symbols-outlined nav-icon">${escapeHtml(pageMeta[page].icon)}</span>
          <span class="nav-copy">
            <strong>${escapeHtml(pageMeta[page].label)}</strong>
            <small>${escapeHtml(pageMeta[page].hint)}</small>
          </span>
        </button>
      `
    )
    .join("");
}

function updatePageHeader() {
  const current = pageMeta[state.activePage];
  el.pageTitle.textContent = current.title;
  el.pageSubtitle.textContent = current.subtitle;
}

function renderDropdownOptions(container, values, selected, name) {
  container.innerHTML = values
    .map(
      (value) => `
        <label class="dropdown-option">
          <input type="checkbox" name="${name}" value="${escapeHtml(value)}" ${selected.includes(value) ? "checked" : ""} />
          <span>${escapeHtml(value)}</span>
        </label>
      `
    )
    .join("");
}

function renderStaticPills(container, values) {
  container.innerHTML = values.map((value) => `<span class="static-pill">${escapeHtml(value)}</span>`).join("");
}

function getSelectedValues(name) {
  return Array.from(document.querySelectorAll(`input[name="${name}"]:checked`)).map((input) => input.value);
}

function updateFilterCounts() {
  const allBranchesSelected = state.filters.cabang.length === state.filterOptions.cabang.length;
  const allBrandsSelected = state.filters.brand.length === state.filterOptions.brand.length;
  el.branchCount.textContent = allBranchesSelected ? "Semua cabang" : `${state.filters.cabang.length} cabang`;
  el.brandCount.textContent = allBrandsSelected ? "Semua brand" : `${state.filters.brand.length} brand`;
}

function syncFiltersToForm() {
  el.startDate.value = state.filters.start;
  el.endDate.value = state.filters.end;
  renderDropdownOptions(el.branchOptions, state.filterOptions.cabang, state.filters.cabang, "cabang");
  renderDropdownOptions(el.brandOptions, state.filterOptions.brand, state.filters.brand, "brand");
  renderStaticPills(el.channelOptions, state.filterOptions.channel);
  updateFilterCounts();
}

function readFiltersFromForm() {
  const selectedBranches = getSelectedValues("cabang");
  const selectedBrands = getSelectedValues("brand");
  state.filters = {
    start: el.startDate.value,
    end: el.endDate.value,
    cabang: selectedBranches.length ? selectedBranches : [...state.filterOptions.cabang],
    brand: selectedBrands.length ? selectedBrands : [...state.filterOptions.brand],
    channel: [...state.filterOptions.channel],
  };
  updateFilterCounts();
}

function resetFiltersToDefault() {
  state.filters = {
    start: state.filterOptions.defaults.start,
    end: state.filterOptions.defaults.end,
    cabang: [...state.filterOptions.cabang],
    brand: [...state.filterOptions.brand],
    channel: [...state.filterOptions.channel],
  };
  syncFiltersToForm();
}

async function loadFilters() {
  state.filterOptions = await apiFetch("/api/filters");
  if (!state.filters.start) {
    resetFiltersToDefault();
  } else {
    if (!state.filters.channel?.length) {
      state.filters.channel = [...state.filterOptions.channel];
    }
    syncFiltersToForm();
  }
}

const metricMeta = {
  gmv: { icon: "payments", note: "Nilai penjualan bruto", className: "is-featured", chip: "Total GMV" },
  nett_gmv: { icon: "account_balance_wallet", note: "Pendapatan bersih setelah potongan", className: "is-featured", chip: "Nett revenue" },
  run_rate: { icon: "rocket_launch", note: "Proyeksi nilai akhir bulan berjalan", className: "is-featured", chip: "Projected" },
  ads: { icon: "campaign", note: "Belanja ads selama periode aktif", className: "is-compact", chip: "Media spend" },
  diskon: { icon: "local_offer", note: "Diskon dan potongan promo", className: "is-compact", chip: "Promo cost" },
  cash_in: { icon: "point_of_sale", note: "Dana aktual yang sudah masuk", className: "is-compact", chip: "Actual cash in" },
  selisih: { icon: "warning", note: "Gap antara terima dan uang masuk", className: "is-compact", chip: "Attention" },
};

function metricCard(card) {
  const meta = metricMeta[card.key] || { icon: "analytics", note: "Ringkasan metrik utama", className: "is-compact", chip: "Metric" };
  return `
    <article class="kpi-card ${escapeHtml(meta.className)} accent-${escapeHtml(card.accent)}">
      <div class="kpi-card-orb"></div>
      <div class="metric-head">
        <div class="metric-icon">
          <span class="material-symbols-outlined">${escapeHtml(meta.icon)}</span>
        </div>
        <span class="metric-chip">${escapeHtml(meta.chip)}</span>
      </div>
      <div class="metric-label">${escapeHtml(card.label)}</div>
      <div class="metric-value">${formatCurrency(card.value)}</div>
      <div class="card-subtitle">${escapeHtml(meta.note)}</div>
      <div class="metric-delta ${deltaClass(card.delta)}">${formatSignedPercent(card.delta)}</div>
    </article>
  `;
}

function vvaCard(label, data, icon) {
  const deltaValue = typeof data?.delta === "number" ? data.delta : null;
  const deltaClass_ = deltaValue === null ? "" : deltaValue >= 0 ? "positive" : "negative";
  const deltaText = deltaValue !== null
    ? `${deltaValue > 0 ? "+" : ""}${deltaValue.toFixed(1)}% vs periode sebelumnya`
    : "vs periode sebelumnya";

  return `
    <article class="kpi-card vva-card">
      <div class="kpi-card-orb"></div>
      <div class="metric-head">
        <div class="metric-icon">
          <span class="material-symbols-outlined">${escapeHtml(icon)}</span>
        </div>
        <span class="metric-chip">VVA Group</span>
      </div>
      <div class="metric-label">${escapeHtml(label)}</div>
      <div class="metric-value">${formatCurrency(data?.gmv || 0)}</div>
      <div class="card-subtitle">
        Kontribusi ${formatPercent(data?.contribution)} dari total GMV
      </div>
      <div class="metric-delta ${deltaClass_}">${escapeHtml(deltaText)}</div>
    </article>
  `;
}

function renderOverview() {
  const payload = state.data.kpi;
  const logs = state.data.syncLogs?.logs || [];
  if (!payload) {
    el.overviewPage.innerHTML = emptyState("Belum ada data overview", "Silakan login dan terapkan filter.");
    return;
  }

  const highlights = payload.highlights;
  const vvaHtml = payload.vva ? `
    <div class="section-heading" style="margin-top:24px;">
      <div>
        <h3>Ringkasan Penjualan VVA</h3>
        <p>Kontribusi GMV dari cluster VVA Pusat (Jabodetabek) dan VVA Cabang (luar kota).</p>
      </div>
      <span class="badge">VVA Group</span>
    </div>
    <div class="vva-grid">
      ${vvaCard("GMV VVA Pusat", payload.vva.pusat, "location_city")}
      ${vvaCard("GMV VVA Cabang", payload.vva.cabang, "map")}
    </div>
  ` : "";

  el.overviewPage.innerHTML = `
    <div class="section-heading">
      <div>
        <h3>KPI utama bisnis</h3>
        <p>Tampilan ringkas gaya command center untuk melihat angka penting tanpa perlu berpindah halaman.</p>
      </div>
      <span class="badge">Periode ${escapeHtml(formatDate(payload.period.start))} - ${escapeHtml(formatDate(payload.period.end))}</span>
    </div>

    <div class="metric-grid">${payload.cards.map(metricCard).join("")}</div>
    ${vvaHtml}

    <div class="content-grid" style="margin-top:20px;">
      <article class="insight-card">
        <div class="card-headline">
          <div>
            <h3>Insight cepat</h3>
            <p>Prioritas yang layak dipantau pada periode aktif.</p>
          </div>
          <span class="badge subtle">Live highlights</span>
        </div>
        <ul class="insight-list">
          <li>
            <strong>Cabang teratas: ${escapeHtml(highlights.top_branch?.cabang || "-")}</strong>
            GMV ${formatCurrency(highlights.top_branch?.gmv || 0)} dengan selisih ${formatCurrency(highlights.top_branch?.selisih || 0)}.
          </li>
          <li>
            <strong>Brand paling dominan: ${escapeHtml(highlights.top_brand?.brand || "-")}</strong>
            Nett GMV ${formatCurrency(highlights.top_brand?.nett_gmv || 0)} pada filter aktif.
          </li>
          <li>
            <strong>Channel terbesar: ${escapeHtml(highlights.top_channel?.channel || "-")}</strong>
            Kontribusi GMV ${formatCurrency(highlights.top_channel?.gmv || 0)}.
          </li>
          <li>
            <strong>Cabang dengan gap terbesar: ${escapeHtml(highlights.largest_gap_branch?.cabang || "-")}</strong>
            Selisih ${formatCurrency(highlights.largest_gap_branch?.selisih || 0)}.
          </li>
        </ul>
      </article>

      <article class="summary-card">
        <span class="eyebrow">Derived KPI</span>
        <strong>${formatPercent(payload.derived.collection_rate)}</strong>
        <small>Collection rate</small>
        <strong>${formatPercent(payload.derived.net_margin)}</strong>
        <small>Net margin</small>
        <strong>${formatPercent(payload.derived.ads_efficiency)}</strong>
        <small>Efisiensi ads</small>
        <strong>${formatPercent(payload.derived.discount_rate)}</strong>
        <small>Discount rate</small>
      </article>
    </div>

    <div class="table-grid" style="margin-top:20px;">
      <article class="table-card">
        <div class="card-headline">
          <div>
            <h3>Operational sync log</h3>
            <p>Audit terbaru untuk pipeline Google Sheets ke warehouse.</p>
          </div>
          <span class="badge subtle">Latest runs</span>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Waktu</th>
                <th>Status</th>
                <th>Rows</th>
                <th>Trigger</th>
              </tr>
            </thead>
            <tbody>
              ${
                logs.length
                  ? logs
                      .slice(0, 5)
                      .map(
                        (log) => `
                          <tr>
                            <td>${escapeHtml(formatDate(log.started_at))}</td>
                            <td>${escapeHtml(log.status)}</td>
                            <td>${escapeHtml(String(log.rows_upserted))}</td>
                            <td>${escapeHtml(log.triggered_by)}</td>
                          </tr>
                        `
                      )
                      .join("")
                  : `<tr><td colspan="4">Belum ada log sinkronisasi.</td></tr>`
              }
            </tbody>
          </table>
        </div>
      </article>

      <article class="list-card">
        <div class="card-headline">
          <div>
            <h3>Filter snapshot</h3>
            <p>Scope global yang sedang dipakai untuk seluruh halaman.</p>
          </div>
          <span class="badge subtle">Applied filters</span>
        </div>
        <ul class="bullet-list">
          <li><strong>Tanggal</strong>${escapeHtml(formatDate(state.filters.start))} sampai ${escapeHtml(formatDate(state.filters.end))}</li>
          <li><strong>Cabang</strong>${escapeHtml(state.filters.cabang.join(", "))}</li>
          <li><strong>Brand</strong>${escapeHtml(state.filters.brand.join(", "))}</li>
          <li><strong>Channel</strong>${escapeHtml(state.filters.channel.join(", "))}</li>
        </ul>
      </article>
    </div>
  `;
}

function renderTrendPage() {
  const payload = state.data.trend;
  if (!payload) {
    el.trendPage.innerHTML = emptyState("Belum ada data tren", "Ubah filter untuk memuat tren harian.");
    return;
  }

  el.trendPage.innerHTML = `
    <div class="section-heading">
      <div>
        <h3>GMV vs Nett GMV vs Ads</h3>
        <p>Line dan bar chart mengikuti spesifikasi halaman Tren Harian di PRD.</p>
      </div>
      <span class="badge">Rata-rata harian tersedia</span>
    </div>
    <div class="chart-card">
      <div id="trend-chart"></div>
    </div>
    <div class="table-card" style="margin-top:18px;">
      <h3>Cuplikan 10 hari terakhir</h3>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Tanggal</th>
              <th>GMV</th>
              <th>Nett GMV</th>
              <th>Ads</th>
            </tr>
          </thead>
          <tbody>
            ${payload.points
              .slice(-10)
              .reverse()
              .map(
                (point) => `
                  <tr>
                    <td>${escapeHtml(formatDate(point.date))}</td>
                    <td>${formatCurrency(point.gmv)}</td>
                    <td>${formatCurrency(point.nett_gmv)}</td>
                    <td>${formatCurrency(point.ads)}</td>
                  </tr>
                `
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;

  renderTrendChart(document.getElementById("trend-chart"), payload);
}

function renderBrandPage() {
  const payload = state.data.brand;
  if (!payload?.rows?.length) {
    el.brandPage.innerHTML = emptyState("Belum ada data brand", "Pilih filter lain untuk melihat performa brand.");
    return;
  }

  el.brandPage.innerHTML = `
    <div class="content-grid">
      <article class="chart-card">
        <h3>Ranking brand berdasarkan GMV</h3>
        <p>Urutan descending sesuai requirement halaman Performa Brand.</p>
        <div id="brand-bars" style="margin-top:18px;"></div>
      </article>
      <article class="chart-card">
        <h3>Kontribusi GMV per brand</h3>
        <p>Donut chart menunjukkan share masing-masing brand terhadap total GMV.</p>
        <div id="brand-donut" style="margin-top:18px;"></div>
      </article>
    </div>

    <div class="table-card" style="margin-top:18px;">
      <h3>Tabel detail brand</h3>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Brand</th>
              <th>GMV</th>
              <th>Nett GMV</th>
              <th>Ads</th>
              <th>Diskon</th>
              <th>% Kontribusi</th>
            </tr>
          </thead>
          <tbody>
            ${payload.rows
              .map(
                (row) => `
                  <tr>
                    <td>${escapeHtml(row.brand)}</td>
                    <td>${formatCurrency(row.gmv)}</td>
                    <td>${formatCurrency(row.nett_gmv)}</td>
                    <td>${formatCurrency(row.ads)}</td>
                    <td>${formatCurrency(row.diskon)}</td>
                    <td>${formatPercent(row.contribution)}</td>
                  </tr>
                `
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;

  renderHorizontalBars(document.getElementById("brand-bars"), payload.rows, "gmv", "brand");
  renderDonutChart(document.getElementById("brand-donut"), payload.rows, "brand");
}

function tableForBranches(title, subtitle, rows, isBottom = false) {
  return `
    <article class="table-card">
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(subtitle)}</p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Rank</th>
              <th>Cabang</th>
              <th>GMV</th>
              <th>Nett GMV</th>
            </tr>
          </thead>
          <tbody>
            ${rows
              .map(
                (row, index) => `
                  <tr>
                    <td><span class="rank ${isBottom ? "rank-bad" : ""}">${index + 1}</span></td>
                    <td>${escapeHtml(row.cabang)}</td>
                    <td>${formatCurrency(row.gmv)}</td>
                    <td>${formatCurrency(row.nett_gmv)}</td>
                  </tr>
                `
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </article>
  `;
}

function renderBranchPage() {
  const payload = state.data.branch;
  if (!payload?.top?.length) {
    el.branchPage.innerHTML = emptyState("Belum ada data cabang", "Pilih kombinasi filter lain untuk melihat ranking cabang.");
    return;
  }

  el.branchPage.innerHTML = `
    <div class="split-grid">
      ${tableForBranches("Top 5 cabang", "Cabang dengan GMV tertinggi.", payload.top)}
      ${tableForBranches("Bottom 5 cabang", "Cabang yang perlu perhatian operasional lebih cepat.", payload.bottom, true)}
    </div>
    <div class="table-card" style="margin-top:18px;">
      <h3>Selisih terbesar per cabang</h3>
      <p>Daftar prioritas investigasi untuk tim finance dan operasional.</p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Cabang</th>
              <th>Terima</th>
              <th>Uang Masuk</th>
              <th>Selisih</th>
            </tr>
          </thead>
          <tbody>
            ${payload.gaps
              .map(
                (row) => `
                  <tr>
                    <td>${escapeHtml(row.cabang)}</td>
                    <td>${formatCurrency(row.nett_gmv)}</td>
                    <td>${formatCurrency(row.cash_in)}</td>
                    <td class="${row.selisih > 0 ? "cell-negative" : ""}">${formatCurrency(row.selisih)}</td>
                  </tr>
                `
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderPlatformPage() {
  const payload = state.data.platform;
  if (!payload?.rows?.length) {
    el.platformPage.innerHTML = emptyState("Belum ada data platform", "Pilih filter lain untuk melihat performa channel.");
    return;
  }

  el.platformPage.innerHTML = `
    <div class="metric-grid">
      ${payload.rows
        .map(
          (row) => `
            <article class="kpi-card">
              <div class="summary-inline">
                <span class="metric-label">${escapeHtml(row.channel)}</span>
                <span class="badge" style="background:${escapeHtml(row.color)}22; color:${escapeHtml(row.color)};">${escapeHtml(row.channel)}</span>
              </div>
              <div class="metric-value">${formatCurrency(row.gmv)}</div>
              <div class="card-subtitle">Kontribusi ${formatPercent(row.contribution)} dari total GMV</div>
            </article>
          `
        )
        .join("")}
    </div>

    <div class="chart-card" style="margin-top:18px;">
      <h3>Perbandingan GMV, Nett GMV, dan Ads</h3>
      <p>Grouped bar chart sesuai PRD halaman Performa Platform.</p>
      <div id="platform-chart" style="margin-top:18px;"></div>
    </div>

    <div class="table-card" style="margin-top:18px;">
      <h3>Tabel perbandingan channel</h3>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Channel</th>
              <th>GMV</th>
              <th>Nett GMV</th>
              <th>Ads</th>
              <th>Diskon</th>
              <th>% GMV Total</th>
            </tr>
          </thead>
          <tbody>
            ${payload.rows
              .map(
                (row) => `
                  <tr>
                    <td>${escapeHtml(row.channel)}</td>
                    <td>${formatCurrency(row.gmv)}</td>
                    <td>${formatCurrency(row.nett_gmv)}</td>
                    <td>${formatCurrency(row.ads)}</td>
                    <td>${formatCurrency(row.diskon)}</td>
                    <td>${formatPercent(row.contribution)}</td>
                  </tr>
                `
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;

  renderGroupedBars(document.getElementById("platform-chart"), payload.rows);
}

function reconciliationExportRows() {
  const rows = state.data.reconciliation?.rows || [];
  return rows.map((row) => ({
    tanggal: row.tanggal,
    cabang: row.cabang,
    channel: row.channel,
    brand: row.brand,
    terima: row.terima,
    uang_masuk: row.uang_masuk ?? "",
    selisih: row.selisih ?? "",
    kode_mutasi: row.kode_mutasi,
  }));
}

function renderReconciliationPage() {
  const payload = state.data.reconciliation;
  if (!payload) {
    el.reconciliationPage.innerHTML = emptyState("Belum ada data rekonsiliasi", "Login dan terapkan filter untuk melihat data.");
    return;
  }

  el.reconciliationPage.innerHTML = `
    <div class="page-toolbar">
      <div>
        <h3 style="margin:0;">Ringkasan rekonsiliasi</h3>
        <p class="muted">Filter tambahan ini hanya berlaku di halaman Rekonsiliasi.</p>
      </div>
      <div class="summary-inline">
        <label class="toggle">
          <input type="checkbox" id="only-difference" ${state.onlyDifference ? "checked" : ""} />
          Tampilkan hanya selisih != 0
        </label>
        <button class="export-button" id="export-reconciliation">Export CSV</button>
      </div>
    </div>

    <div class="summary-grid">
      <article class="summary-card">
        <span class="eyebrow">Total Terima</span>
        <strong>${formatCurrency(payload.summary.terima)}</strong>
        <small>Nett GMV pada baris terfilter</small>
      </article>
      <article class="summary-card">
        <span class="eyebrow">Total Uang Masuk</span>
        <strong>${formatCurrency(payload.summary.uang_masuk)}</strong>
        <small>Cash in aktual yang tercatat</small>
      </article>
      <article class="summary-card">
        <span class="eyebrow">Total Selisih</span>
        <strong class="${payload.summary.selisih > 0 ? "cell-negative" : ""}">${formatCurrency(payload.summary.selisih)}</strong>
        <small>${payload.summary.rows} baris tampil di tabel</small>
      </article>
    </div>

    <div class="table-card" style="margin-top:18px;">
      <h3>Detail rekonsiliasi</h3>
      <p>Tabel mengikuti requirement tanggal, cabang, channel, terima, uang masuk, selisih, dan kode mutasi.</p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Tanggal</th>
              <th>Cabang</th>
              <th>Channel</th>
              <th>Brand</th>
              <th>Terima</th>
              <th>Uang Masuk</th>
              <th>Selisih</th>
              <th>Kode Mutasi</th>
            </tr>
          </thead>
          <tbody>
            ${
              payload.rows.length
                ? payload.rows
                    .map(
                      (row) => `
                        <tr>
                          <td>${escapeHtml(formatDate(row.tanggal))}</td>
                          <td>${escapeHtml(row.cabang)}</td>
                          <td>${escapeHtml(row.channel)}</td>
                          <td>${escapeHtml(row.brand)}</td>
                          <td>${formatCurrency(row.terima)}</td>
                          <td>${row.uang_masuk === null ? "N/A" : formatCurrency(row.uang_masuk)}</td>
                          <td class="${(row.selisih || 0) > 0 ? "cell-negative" : ""}">${row.selisih === null ? "N/A" : formatCurrency(row.selisih)}</td>
                          <td>${escapeHtml(row.kode_mutasi)}</td>
                        </tr>
                      `
                    )
                    .join("")
                : `<tr><td colspan="8">Tidak ada baris yang sesuai dengan filter.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById("only-difference").addEventListener("change", async (event) => {
    state.onlyDifference = event.target.checked;
    await refreshData();
  });

  document.getElementById("export-reconciliation").addEventListener("click", () => {
    downloadCsv("rekonsiliasi-dashboard-restoran.csv", reconciliationExportRows());
  });
}

function renderSyncSummary() {
  const latest = state.data.syncLogs?.logs?.[0];
  if (!latest) {
    el.syncSummary.textContent = "Belum ada log sinkronisasi.";
    return;
  }

  const sourceMode = state.data.syncLogs?.source_mode || state.data.kpi?.source_mode || "sample";
  el.syncSummary.innerHTML = `
    <div class="sync-badge ${latest.status === "SUCCESS" ? "is-success" : "is-warning"}">${escapeHtml(latest.status)}</div>
    <strong>Sinkronisasi terakhir ${escapeHtml(formatDate(latest.started_at))}</strong>
    <span>Dipicu oleh ${escapeHtml(latest.triggered_by)} dengan ${escapeHtml(String(latest.rows_upserted))} baris di-upsert.</span>
    <span>Baris gagal: ${escapeHtml(String(latest.rows_failed))} • Data source: ${escapeHtml(sourceMode)}</span>
  `;
}

function togglePages() {
  Object.entries(pageMeta).forEach(([page, meta]) => {
    document.getElementById(meta.id).classList.toggle("is-hidden", page !== state.activePage);
  });
}

function renderActivePage() {
  renderSession();
  renderPageNav();
  updatePageHeader();
  togglePages();
  renderSyncSummary();

  if (allowedPages().includes("overview")) {
    renderOverview();
  }
  if (allowedPages().includes("trend") && state.data.trend) {
    renderTrendPage();
  }
  if (allowedPages().includes("brand") && state.data.brand) {
    renderBrandPage();
  }
  if (allowedPages().includes("branch") && state.data.branch) {
    renderBranchPage();
  }
  if (allowedPages().includes("platform") && state.data.platform) {
    renderPlatformPage();
  }
  if (allowedPages().includes("reconciliation") && state.data.reconciliation) {
    renderReconciliationPage();
  }
}

async function refreshData() {
  if (!state.session) {
    return;
  }

  readFiltersFromForm();
  setStatus("Memuat ulang KPI, tren, performa brand, cabang, platform, dan rekonsiliasi...");

  try {
    const query = buildQuery(state.filters);
    const requests = [apiFetch(`/api/kpi?${query}`), apiFetch("/api/sync/logs")];
    const pageLoaders = {
      trend: () => apiFetch(`/api/trend/daily?${query}`),
      brand: () => apiFetch(`/api/brand?${query}`),
      branch: () => apiFetch(`/api/cabang?${query}`),
      platform: () => apiFetch(`/api/platform?${query}`),
      reconciliation: () =>
        apiFetch(`/api/rekonsiliasi?${buildQuery(state.filters, { only_difference: state.onlyDifference })}`),
    };

    if (pageLoaders[state.activePage]) {
      requests.push(pageLoaders[state.activePage]());
    }

    const responses = await Promise.all(requests);
    let cursor = 0;
    state.data.kpi = responses[cursor++];
    state.data.syncLogs = responses[cursor++];

    if (state.activePage === "trend") {
      state.data.trend = responses[cursor++];
    }
    if (state.activePage === "brand") {
      state.data.brand = responses[cursor++];
    }
    if (state.activePage === "branch") {
      state.data.branch = responses[cursor++];
    }
    if (state.activePage === "platform") {
      state.data.platform = responses[cursor++];
    }
    if (state.activePage === "reconciliation") {
      state.data.reconciliation = responses[cursor++];
    }

    renderActivePage();
    setStatus(`Dashboard siap. Data terfilter dari ${formatDate(state.filters.start)} sampai ${formatDate(state.filters.end)}.`);
  } catch (error) {
    reportLoadFailure("refreshData", error);
    throw error;
  }
}

async function handleLogin(event) {
  event.preventDefault();
  el.loginError.textContent = "";

  try {
    const session = await apiFetch("/api/login", {
      method: "POST",
      body: JSON.stringify({
        username: document.getElementById("username").value,
        password: document.getElementById("password").value,
      }),
    });

    persistSession(session);
    ensureActivePage();
    el.loginModal.classList.add("is-hidden");
    await refreshData();
  } catch (error) {
    el.loginError.textContent = error.message;
  }
}

async function handleManualSync() {
  if (!state.session || state.session.role !== "executive") {
    setStatus("Trigger sync manual hanya dibuka untuk role executive pada demo ini.");
    return;
  }

  try {
    setStatus("Memicu sync manual sesuai requirement F-06...");
    await apiFetch("/api/sync/trigger", {
      method: "POST",
      body: JSON.stringify({ triggered_by: state.session.username }),
    });
    await refreshData();
  } catch (error) {
    reportLoadFailure("handleManualSync", error);
  }
}

function handleLogout() {
  clearSession();
  el.loginModal.classList.remove("is-hidden");
  state.data = {};
  state.onlyDifference = false;
  renderSession();
  el.pageNav.innerHTML = "";
  Object.values(pageMeta).forEach((meta) => {
    document.getElementById(meta.id).innerHTML = "";
  });
  setStatus("Sesi berakhir. Login kembali untuk membuka dashboard.");
}

function bindEvents() {
  el.loginForm.addEventListener("submit", handleLogin);
  el.pageNav.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-page]");
    if (!button) {
      return;
    }
    state.activePage = button.dataset.page;
    await refreshData();
  });
  el.syncButton.addEventListener("click", handleManualSync);
  el.logoutButton.addEventListener("click", handleLogout);
  el.applyFilters.addEventListener("click", refreshData);
  el.resetFilters.addEventListener("click", async () => {
    resetFiltersToDefault();
    await refreshData();
  });
  document.addEventListener("click", (event) => {
    const branchDropdown = document.getElementById("branch-dropdown");
    const brandDropdown = document.getElementById("brand-dropdown");
    if (branchDropdown && !branchDropdown.contains(event.target)) {
      branchDropdown.removeAttribute("open");
    }
    if (brandDropdown && !brandDropdown.contains(event.target)) {
      brandDropdown.removeAttribute("open");
    }
  });
}

async function init() {
  try {
    bindEvents();
    await loadFilters();

    if (state.session) {
      ensureActivePage();
      el.loginModal.classList.add("is-hidden");
      await refreshData();
      return;
    }

    renderSession();
    setStatus("Menunggu login.");
  } catch (error) {
    reportLoadFailure("init", error);
  }
}

init();
