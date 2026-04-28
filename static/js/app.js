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
} from "./utils.js?v=20260428-1";
import {
  renderDonutChart,
  renderGroupedBars,
  renderHeatmapBar,
  renderHorizontalBars,
  renderTrendChart,
  renderWeeklyBars,
} from "./charts.js?v=20260428-1";

const plainNumberFormatter = new Intl.NumberFormat("id-ID", {
  maximumFractionDigits: 0,
});
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const motionState = {
  values: new Map(),
};
const interactionState = {
  autoRefreshTimer: null,
  latestRequestId: 0,
};

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
  deepdive: {
    id: "deepdive-page",
    title: "Deep Dive GMV & Ads",
    subtitle: "Analisis mendalam GMV dan Ads Spend per outlet, per brand, dan breakdown mingguan.",
    label: "Deep Dive",
    icon: "manage_search",
    hint: "Gali lebih dalam GMV & Ads",
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
  kpiDetailRows: [],
  kpiDetailSort: { key: "value", direction: "desc" },
  deepDiveTab: "outlet",
  deepDiveSort: {
    outlet: { key: "gmv", direction: "desc" },
    brand: { key: "gmv", direction: "desc" },
    week: { key: "week_start", direction: "asc" },
  },
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
  deepdivePage: document.getElementById("deepdive-page"),
  brandPage: document.getElementById("brand-page"),
  branchPage: document.getElementById("branch-page"),
  platformPage: document.getElementById("platform-page"),
  reconciliationPage: document.getElementById("reconciliation-page"),
  syncButton: document.getElementById("sync-button"),
  logoutButton: document.getElementById("logout-button"),
  applyFilters: document.getElementById("apply-filters"),
  resetFilters: document.getElementById("reset-filters"),
  toolbarShell: document.querySelector(".toolbar-shell"),
  branchDropdown: document.getElementById("branch-dropdown"),
  brandDropdown: document.getElementById("brand-dropdown"),
  avatarDropdown: document.querySelector(".avatar-dropdown"),
  toolbarPanel: document.querySelector(".toolbar-panel"),
  kpiDetailModal: document.getElementById("kpi-detail-modal"),
  kpiDetailTitle: document.getElementById("kpi-detail-title"),
  kpiDetailBody: document.getElementById("kpi-detail-body"),
  kpiDetailClose: document.getElementById("kpi-detail-close"),
};

function motionAllowed() {
  return !prefersReducedMotion.matches;
}

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

function setToolbarApplying(isApplying) {
  el.toolbarShell?.classList.toggle("is-applying", isApplying);
}

function setButtonBusy(button, isBusy, busyLabel) {
  if (!button) {
    return;
  }

  if (isBusy) {
    if (!button.dataset.defaultLabel) {
      button.dataset.defaultLabel = button.innerHTML;
    }
    button.disabled = true;
    button.classList.add("is-busy");
    if (busyLabel) {
      button.innerHTML = `<span class="spinner-dot" aria-hidden="true"></span>${escapeHtml(busyLabel)}`;
    }
    return;
  }

  button.disabled = false;
  button.classList.remove("is-busy");
  if (button.dataset.defaultLabel) {
    button.innerHTML = button.dataset.defaultLabel;
  }
}

function formatAnimatedValue(value, format) {
  if (format === "percent") {
    return formatPercent(value);
  }
  if (format === "integer") {
    return plainNumberFormatter.format(Math.round(Number(value || 0)));
  }
  return formatCurrency(value);
}

function animatedValue(tagName, className, value, format, metricId) {
  const numericValue = Number(value || 0);
  return `<${tagName} class="${className}" data-animate-number="true" data-format="${format}" data-raw-value="${numericValue}" data-metric-id="${metricId}">${formatAnimatedValue(numericValue, format)}</${tagName}>`;
}

function animateValue(element, from, to, format, metricId) {
  const roundedTarget = Number(to || 0);
  if (!motionAllowed()) {
    element.textContent = formatAnimatedValue(roundedTarget, format);
    motionState.values.set(metricId, roundedTarget);
    return;
  }

  const startValue = Number(from || 0);
  const diff = roundedTarget - startValue;
  const duration = 220;
  const startAt = performance.now();

  function tick(now) {
    const progress = Math.min((now - startAt) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 4);
    const nextValue = startValue + diff * eased;
    element.textContent = formatAnimatedValue(nextValue, format);

    if (progress < 1) {
      window.requestAnimationFrame(tick);
      return;
    }

    element.textContent = formatAnimatedValue(roundedTarget, format);
    motionState.values.set(metricId, roundedTarget);
  }

  window.requestAnimationFrame(tick);
}

function activateValueTransitions(root = document) {
  if (!root) {
    return;
  }
  root.querySelectorAll("[data-animate-number='true']").forEach((element) => {
    const metricId = element.dataset.metricId;
    const format = element.dataset.format || "currency";
    const nextValue = Number(element.dataset.rawValue || 0);
    const previousValue = motionState.values.get(metricId);

    if (previousValue === undefined) {
      animateValue(element, 0, nextValue, format, metricId);
      return;
    }

    if (Math.abs(previousValue - nextValue) < 0.01) {
      element.textContent = formatAnimatedValue(nextValue, format);
      motionState.values.set(metricId, nextValue);
      return;
    }

    element.classList.remove("value-updated");
    void element.offsetWidth;
    element.classList.add("value-updated");
    animateValue(element, previousValue, nextValue, format, metricId);
  });
}

function renderOverviewSkeleton() {
  return `
    <div class="section-heading skeleton-shell">
      <div class="skeleton-copy">
        <div class="skeleton-line skeleton-line-title"></div>
        <div class="skeleton-line skeleton-line-subtitle"></div>
      </div>
      <div class="skeleton-pill"></div>
    </div>
    <div class="metric-grid">
      ${Array.from({ length: 7 }, () => `
        <article class="kpi-card skeleton-card">
          <div class="skeleton-row">
            <div class="skeleton-avatar"></div>
            <div class="skeleton-pill"></div>
          </div>
          <div class="skeleton-line skeleton-line-label"></div>
          <div class="skeleton-line skeleton-line-value"></div>
          <div class="skeleton-line skeleton-line-subtitle"></div>
        </article>
      `).join("")}
    </div>
    <div class="content-grid page-gap-sm">
      ${Array.from({ length: 2 }, () => `
        <article class="summary-card skeleton-card">
          <div class="skeleton-line skeleton-line-title"></div>
          <div class="skeleton-line skeleton-line-value"></div>
          <div class="skeleton-line skeleton-line-subtitle"></div>
          <div class="skeleton-line skeleton-line-subtitle short"></div>
        </article>
      `).join("")}
    </div>
  `;
}

function renderGenericSkeleton(title) {
  return `
    <div class="section-heading skeleton-shell">
      <div class="skeleton-copy">
        <div class="skeleton-line skeleton-line-title"></div>
        <div class="skeleton-line skeleton-line-subtitle"></div>
      </div>
      <div class="skeleton-pill"></div>
    </div>
    <article class="chart-card skeleton-card">
      <div class="skeleton-line skeleton-line-title"></div>
      <div class="skeleton-chart"></div>
      <div class="skeleton-line skeleton-line-subtitle"></div>
    </article>
    <article class="table-card skeleton-card page-gap-sm">
      <div class="skeleton-line skeleton-line-title"></div>
      <div class="skeleton-table">
        ${Array.from({ length: 5 }, () => `<div class="skeleton-row-line"></div>`).join("")}
      </div>
    </article>
  `;
}

function showLoadingState() {
  const target = el[`${state.activePage}Page`];
  if (!target) {
    return;
  }

  renderPageNav();
  updatePageHeader();
  togglePages();
  document.body.classList.add("is-refreshing");
  el.statusBanner.classList.add("is-busy");
  target.classList.add("is-loading");
  target.innerHTML = state.activePage === "overview" ? renderOverviewSkeleton() : renderGenericSkeleton(state.activePage);
}

function clearLoadingState() {
  document.body.classList.remove("is-refreshing");
  el.statusBanner.classList.remove("is-busy");
  Object.values(pageMeta).forEach((meta) => {
    const page = document.getElementById(meta.id);
    page.classList.remove("is-loading");
  });
}

function playSurfaceEntrance() {
  const target = el[`${state.activePage}Page`];
  if (!target || !motionAllowed()) {
    return;
  }
  target.classList.remove("is-settling");
  void target.offsetWidth;
  target.classList.add("is-settling");
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
        <button class="nav-pill ${state.activePage === page ? "is-active" : ""}" data-page="${page}" type="button" ${state.activePage === page ? 'aria-current="page"' : ""}>
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

function renderStaticPills(container, values, selected = values) {
  container.innerHTML = values
    .map(
      (value) => `
        <label class="channel-pill ${selected.includes(value) ? "is-selected" : ""}">
          <input type="checkbox" name="channel" value="${escapeHtml(value)}" ${selected.includes(value) ? "checked" : ""} />
          <span>${escapeHtml(value)}</span>
        </label>
      `
    )
    .join("");
}

function getSelectedValues(name) {
  return Array.from(document.querySelectorAll(`input[name="${name}"]:checked`)).map((input) => input.value);
}

function updateFilterCounts() {
  if (!state.filterOptions) {
    return;
  }
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
  renderStaticPills(el.channelOptions, state.filterOptions.channel, state.filters.channel);
  updateFilterCounts();
}

function readFiltersFromForm() {
  if (!state.filterOptions) {
    return;
  }
  const selectedBranches = getSelectedValues("cabang");
  const selectedBrands = getSelectedValues("brand");
  const selectedChannels = getSelectedValues("channel");
  state.filters = {
    start: el.startDate.value,
    end: el.endDate.value,
    cabang: selectedBranches.length ? selectedBranches : [...state.filterOptions.cabang],
    brand: selectedBrands.length ? selectedBrands : [...state.filterOptions.brand],
    channel: selectedChannels.length ? selectedChannels : [...state.filterOptions.channel],
  };
  updateFilterCounts();
}

function scheduleAutoRefresh() {
  readFiltersFromForm();

  if (!state.session) {
    return;
  }
  if (!state.filters.start || !state.filters.end) {
    setStatus("Lengkapi rentang tanggal untuk menerapkan filter.");
    return;
  }

  window.clearTimeout(interactionState.autoRefreshTimer);
  setToolbarApplying(true);
  setStatus("Menerapkan filter terbaru...");
  interactionState.autoRefreshTimer = window.setTimeout(() => {
    refreshData().catch(() => {});
  }, 180);
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
  resetFiltersToDefault();
}

const metricMeta = {
  gmv: { icon: "payments", note: "Nilai penjualan bruto", className: "is-featured", chip: "Total GMV" },
  nett_gmv: { icon: "account_balance_wallet", note: "Pendapatan bersih setelah potongan", className: "is-featured", chip: "Nett revenue" },
  run_rate: { icon: "rocket_launch", note: "Proyeksi nilai akhir bulan berjalan", className: "is-featured", chip: "Projected" },
  ads: { icon: "campaign", note: "Belanja ads selama periode aktif", className: "is-compact", chip: "Media spend" },
  diskon: { icon: "local_offer", note: "Diskon promo (harga coret) pada periode aktif", className: "is-compact", chip: "Promo discount" },
  cash_in: { icon: "point_of_sale", note: "Dana aktual yang sudah masuk", className: "is-compact", chip: "Actual cash in" },
  selisih: { icon: "warning", note: "Gap antara terima dan uang masuk", className: "is-compact", chip: "Attention" },
};

function metricCard(card) {
  const meta = metricMeta[card.key] || { icon: "analytics", note: "Ringkasan metrik utama", className: "is-compact", chip: "Metric" };
  const canDrill = ["gmv", "nett_gmv", "ads", "diskon", "cash_in", "selisih"].includes(card.key);
  const targetHtml = card.key === "run_rate" ? targetEditorHtml(card.value) : "";
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
      ${animatedValue("div", "metric-value", card.value, "currency", `card:${card.key}`)}
      <div class="card-subtitle">${escapeHtml(meta.note)}</div>
      <div class="metric-delta ${deltaClass(card.delta)}">${formatSignedPercent(card.delta)}</div>
      ${targetHtml}
      ${
        canDrill
          ? `<button class="detail-link" type="button" data-kpi-detail="${escapeHtml(card.key)}">Lihat Detail <span aria-hidden="true">-></span></button>`
          : ""
      }
    </article>
  `;
}

function activeMonthKey() {
  const end = state.filters.end || new Date().toISOString().slice(0, 10);
  return end.slice(0, 7);
}

function targetStorageKey() {
  return `gmv-target-${activeMonthKey()}`;
}

function getGmvTarget() {
  return Number(localStorage.getItem(targetStorageKey()) || 0);
}

function setGmvTarget(value) {
  const numericValue = Math.max(0, Number(value || 0));
  if (numericValue) {
    localStorage.setItem(targetStorageKey(), String(numericValue));
    return;
  }
  localStorage.removeItem(targetStorageKey());
}

function targetEditorHtml(runRate) {
  const target = getGmvTarget();
  const progress = target ? Math.min((Number(runRate || 0) / target) * 100, 999) : 0;
  const statusClass = progress >= 100 ? "is-good" : progress >= 70 ? "is-mid" : "is-low";
  const gap = Math.max(target - Number(runRate || 0), 0);
  return `
    <div class="target-widget ${statusClass}">
      <label>
        <span>Target bulan ini</span>
        <input id="gmv-target-input" type="number" min="0" step="1000000" value="${target || ""}" placeholder="Isi target GMV" />
      </label>
      <div class="target-track"><div style="width:${Math.min(progress, 100)}%;"></div></div>
      <small>${target ? `${formatPercent(progress)} tercapai | Sisa ${formatCurrency(gap)}` : "Target belum diisi"}</small>
    </div>
  `;
}

function efficiencyClass(roasValue) {
  if (roasValue >= 3) return "is-good";
  if (roasValue >= 1) return "is-mid";
  return "is-low";
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
      ${animatedValue("div", "metric-value", data?.gmv || 0, "currency", `vva:${label}`)}
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
  const heatmap = state.data.heatmap?.rows || [];
  if (!payload) {
    el.overviewPage.innerHTML = emptyState("Belum ada data overview", "Silakan login dan terapkan filter.");
    return;
  }

  const highlights = payload.highlights;
  const roasValue = Number(payload.derived?.roas || 0);
  const adsPctValue = Number(payload.derived?.ads_pct_gmv || 0);
  const anomalies = payload.anomalies || { high_gap_branches: [], overspend_brands: [] };
  const anomalyCount = (anomalies.high_gap_branches?.length || 0) + (anomalies.overspend_brands?.length || 0);
  const vvaHtml = payload.vva ? `
    <div class="section-heading" style="margin-top:14px;">
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
    <div class="efficiency-strip ${efficiencyClass(roasValue)}">
      <div>
        <span class="eyebrow">Ads efficiency</span>
        <strong>ROAS ${escapeHtml(String(roasValue.toFixed(2)))}</strong>
      </div>
      <div class="efficiency-meter">
        <div style="width:${Math.min((roasValue / 5) * 100, 100)}%;"></div>
      </div>
      <span>Ads/GMV ratio ${formatPercent(adsPctValue)}</span>
    </div>
    ${vvaHtml}

    <div class="chart-card" style="margin-top:14px;">
      <div class="card-headline">
        <div>
          <h3>Distribusi GMV per Hari</h3>
          <p>Heatmap sederhana untuk melihat hari dengan kontribusi GMV tertinggi.</p>
        </div>
        <span class="badge subtle">Day of week</span>
      </div>
      <div id="dow-heatmap"></div>
    </div>

    <div class="content-grid" style="margin-top:14px;">
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
        ${animatedValue("strong", "", payload.derived.collection_rate || 0, "percent", "derived:collection_rate")}
        <small>Collection rate</small>
        ${animatedValue("strong", "", payload.derived.net_margin || 0, "percent", "derived:net_margin")}
        <small>Net margin</small>
        ${animatedValue("strong", "", payload.derived.ads_efficiency || 0, "percent", "derived:ads_efficiency")}
        <small>Efisiensi ads</small>
        ${animatedValue("strong", "", payload.derived.discount_rate || 0, "percent", "derived:discount_rate")}
        <small>Discount rate</small>
      </article>
    </div>

    <div class="table-grid" style="margin-top:14px;">
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

    <details class="attention-panel" style="margin-top:14px;" ${anomalyCount ? "open" : ""}>
      <summary>
        <span class="material-symbols-outlined">warning</span>
        Perlu Perhatian
        <strong>${escapeHtml(String(anomalyCount))}</strong>
      </summary>
      <div class="attention-grid">
        ${
          anomalyCount
            ? [
                ...(anomalies.high_gap_branches || []).map(
                  (row) => `
                    <article class="warning-card">
                      <span class="material-symbols-outlined">account_balance</span>
                      <div>
                        <strong>${escapeHtml(row.cabang)}</strong>
                        <p>Selisih ${formatCurrency(row.selisih)} atau ${formatPercent(row.gap_pct)} dari cash in.</p>
                      </div>
                    </article>
                  `
                ),
                ...(anomalies.overspend_brands || []).map(
                  (row) => `
                    <article class="warning-card">
                      <span class="material-symbols-outlined">campaign</span>
                      <div>
                        <strong>${escapeHtml(row.brand)}</strong>
                        <p>Ads/GMV ${formatPercent(row.ads_pct_gmv)} dengan Ads ${formatCurrency(row.ads)}.</p>
                      </div>
                    </article>
                  `
                ),
              ].join("")
            : `<p class="muted">Belum ada anomali besar pada filter aktif.</p>`
        }
      </div>
    </details>
  `;

  renderHeatmapBar(document.getElementById("dow-heatmap"), heatmap);
  document.getElementById("gmv-target-input")?.addEventListener("change", (event) => {
    setGmvTarget(event.target.value);
    renderOverview();
  });
}

const kpiDetailLabels = {
  gmv: "GMV",
  nett_gmv: "Nett GMV",
  ads: "Ads Spend",
  diskon: "Total Diskon",
  cash_in: "Cash In",
  selisih: "Selisih",
};

function closeKpiDetail() {
  el.kpiDetailModal.style.display = "none";
  state.kpiDetailRows = [];
}

function sortRows(rows, key, direction) {
  const totalRows = rows.filter((row) => row.is_total);
  const sorted = rows.filter((row) => !row.is_total);
  sorted.sort((a, b) => {
    const left = a[key] ?? "";
    const right = b[key] ?? "";
    if (typeof left === "number" && typeof right === "number") {
      return direction === "asc" ? left - right : right - left;
    }
    return direction === "asc"
      ? String(left).localeCompare(String(right))
      : String(right).localeCompare(String(left));
  });
  return [...sorted, ...totalRows];
}

function renderKpiDetailTable(metricKey) {
  const rows = sortRows(state.kpiDetailRows, state.kpiDetailSort.key, state.kpiDetailSort.direction);
  el.kpiDetailBody.innerHTML = `
    <div class="modal-toolbar">
      <span class="badge">Periode ${escapeHtml(formatDate(state.filters.start))} - ${escapeHtml(formatDate(state.filters.end))}</span>
      <button class="secondary-button compact-button" id="kpi-detail-download" type="button">
        <span class="material-symbols-outlined">download</span>
        Download CSV
      </button>
    </div>
    <div class="table-wrap detail-table-wrap">
      <table class="detail-table">
        <thead>
          <tr>
            ${[
              ["index", "No"],
              ["cabang", "Cabang"],
              ["brand", "Brand"],
              ["channel", "Channel"],
              ["value", "Nilai"],
              ["contribution_pct", "% Kontribusi"],
            ]
              .map(([key, label]) => `<th><button type="button" data-detail-sort="${key}">${label}</button></th>`)
              .join("")}
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row, index) => `
                <tr class="${row.is_total ? "is-total-row" : ""}">
                  <td>${index + 1}</td>
                  <td>${escapeHtml(row.cabang)}</td>
                  <td>${escapeHtml(row.brand)}</td>
                  <td>${escapeHtml(row.channel)}</td>
                  <td>${formatCurrency(row.value)}</td>
                  <td>${formatPercent(row.contribution_pct)}</td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;

  el.kpiDetailBody.querySelectorAll("[data-detail-sort]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.detailSort;
      const direction = state.kpiDetailSort.key === key && state.kpiDetailSort.direction === "desc" ? "asc" : "desc";
      state.kpiDetailSort = { key, direction };
      renderKpiDetailTable(metricKey);
    });
  });
  document.getElementById("kpi-detail-download").addEventListener("click", () => {
    downloadCsv(
      `kpi-detail-${metricKey}.csv`,
      rows.map((row, index) => ({
        no: index + 1,
        cabang: row.cabang,
        brand: row.brand,
        channel: row.channel,
        nilai: row.value,
        contribution_pct: row.contribution_pct,
      }))
    );
  });
}

async function openKpiDetail(metricKey) {
  el.kpiDetailTitle.textContent = `Detail ${kpiDetailLabels[metricKey] || metricKey}`;
  el.kpiDetailBody.innerHTML = `<div class="modal-loading"><span class="spinner-dot"></span>Memuat detail KPI...</div>`;
  el.kpiDetailModal.style.display = "flex";
  state.kpiDetailSort = { key: "value", direction: "desc" };

  try {
    const payload = await apiFetch(`/api/kpi/detail?${buildQuery(state.filters, { metric: metricKey })}`);
    state.kpiDetailRows = payload.rows || [];
    renderKpiDetailTable(metricKey);
  } catch (error) {
    reportLoadFailure("openKpiDetail", error);
    el.kpiDetailBody.innerHTML = emptyState("Detail KPI gagal dimuat", describeError(error));
  }
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
    <article class="chart-card">
      <h3>Ranking brand berdasarkan GMV</h3>
      <p>Urutan descending sesuai requirement halaman Performa Brand.</p>
      <div id="brand-bars" style="margin-top:18px;"></div>
    </article>

    <article class="chart-card" style="margin-top:18px;">
      <h3>Kontribusi GMV per brand</h3>
      <p>Donut chart menunjukkan share masing-masing brand terhadap total GMV.</p>
      <div id="brand-donut" style="margin-top:18px;"></div>
    </article>

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
    <div class="platform-score-grid">
      ${payload.rows
        .map(
          (row) => `
            <article class="kpi-card platform-score-card">
              <div class="summary-inline">
                <span class="metric-label">${escapeHtml(row.channel)}</span>
                <span class="badge" style="background:${escapeHtml(row.color)}22; color:${escapeHtml(row.color)};">${escapeHtml(row.channel)}</span>
              </div>
              ${animatedValue("div", "metric-value", row.gmv, "currency", `platform:${row.channel}`)}
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

function roasClass(value) {
  if (Number(value) > 3) return "roas-good";
  if (Number(value) >= 1) return "roas-mid";
  return "roas-low";
}

function withBrandContribution(rows) {
  const total = rows.reduce((sum, row) => sum + Number(row.gmv || 0), 0);
  return rows.map((row) => ({ ...row, contribution: total ? (Number(row.gmv || 0) / total) * 100 : 0 }));
}

function deepDiveTable(rows, groupKey, groupLabel, sortScope) {
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>No</th>
            <th><button type="button" data-deep-sort="${sortScope}:${groupKey}">${escapeHtml(groupLabel)}</button></th>
            <th><button type="button" data-deep-sort="${sortScope}:gmv">GMV</button></th>
            <th><button type="button" data-deep-sort="${sortScope}:ads">Ads Spend</button></th>
            <th><button type="button" data-deep-sort="${sortScope}:nett_gmv">Nett GMV</button></th>
            <th><button type="button" data-deep-sort="${sortScope}:roas">ROAS</button></th>
            <th><button type="button" data-deep-sort="${sortScope}:ads_pct_gmv">% Ads/GMV</button></th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row, index) => `
                <tr>
                  <td>${index + 1}</td>
                  <td>${escapeHtml(row[groupKey])}</td>
                  <td>${formatCurrency(row.gmv)}</td>
                  <td>${formatCurrency(row.ads)}</td>
                  <td>${formatCurrency(row.nett_gmv)}</td>
                  <td class="${roasClass(row.roas)}">${escapeHtml(String(row.roas.toFixed ? row.roas.toFixed(2) : row.roas))}</td>
                  <td>${formatPercent(row.ads_pct_gmv)}</td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function weeklyTable(rows) {
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th><button type="button" data-deep-sort="week:week_start">Minggu</button></th>
            <th><button type="button" data-deep-sort="week:gmv">GMV</button></th>
            <th>Delta GMV</th>
            <th><button type="button" data-deep-sort="week:ads">Ads</button></th>
            <th><button type="button" data-deep-sort="week:nett_gmv">Nett GMV</button></th>
            <th><button type="button" data-deep-sort="week:roas">ROAS</button></th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map((row, index) => {
              const previous = rows[index - 1]?.gmv || 0;
              const delta = previous ? ((row.gmv - previous) / previous) * 100 : null;
              return `
                <tr>
                  <td>${escapeHtml(row.week_label)}</td>
                  <td>${formatCurrency(row.gmv)}</td>
                  <td class="${deltaClass(delta)}">${delta === null ? "N/A" : formatPercent(delta)}</td>
                  <td>${formatCurrency(row.ads)}</td>
                  <td>${formatCurrency(row.nett_gmv)}</td>
                  <td class="${roasClass(row.roas)}">${escapeHtml(String(row.roas.toFixed ? row.roas.toFixed(2) : row.roas))}</td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderDeepDive() {
  const payload = state.data.deepdive;
  if (!payload) {
    el.deepdivePage.innerHTML = emptyState("Belum ada data deep dive", "Terapkan filter untuk memuat analisis GMV dan Ads.");
    return;
  }
  const active = state.deepDiveTab;
  const outletRows = sortRows(payload.by_outlet || [], state.deepDiveSort.outlet.key, state.deepDiveSort.outlet.direction);
  const brandSourceRows = sortRows(payload.by_brand || [], state.deepDiveSort.brand.key, state.deepDiveSort.brand.direction);
  const brandRows = withBrandContribution(brandSourceRows);
  const weekRows = sortRows(payload.by_week || [], state.deepDiveSort.week.key, state.deepDiveSort.week.direction);

  el.deepdivePage.innerHTML = `
    <div class="tab-bar">
      ${[
        ["outlet", "Per Outlet"],
        ["brand", "Per Brand"],
        ["week", "Per Minggu"],
      ]
        .map(([key, label]) => `<button class="${active === key ? "is-active" : ""}" type="button" data-deep-tab="${key}">${label}</button>`)
        .join("")}
    </div>

    <section class="deep-tab ${active === "outlet" ? "" : "is-hidden"}" data-deep-section="outlet">
      <article class="chart-card">
        <div class="card-headline">
          <div>
            <h3>Top 10 outlet by GMV</h3>
            <p>Ranking outlet dengan kontribusi penjualan tertinggi.</p>
          </div>
          <button class="secondary-button compact-button" data-deep-download="outlet" type="button">Download CSV</button>
        </div>
        <div id="deep-outlet-bars"></div>
      </article>
      <article class="table-card" style="margin-top:14px;">
        ${deepDiveTable(outletRows, "cabang", "Cabang", "outlet")}
      </article>
    </section>

    <section class="deep-tab ${active === "brand" ? "" : "is-hidden"}" data-deep-section="brand">
      <div class="content-grid">
        <article class="chart-card">
          <h3>Top brand by GMV</h3>
          <div id="deep-brand-bars" style="margin-top:14px;"></div>
        </article>
        <article class="chart-card">
          <h3>GMV share per brand</h3>
          <div id="deep-brand-donut" style="margin-top:14px;"></div>
        </article>
      </div>
      <article class="table-card" style="margin-top:14px;">
        <div class="card-headline">
          <h3>Tabel brand</h3>
          <button class="secondary-button compact-button" data-deep-download="brand" type="button">Download CSV</button>
        </div>
        ${deepDiveTable(brandSourceRows, "brand", "Brand", "brand")}
      </article>
    </section>

    <section class="deep-tab ${active === "week" ? "" : "is-hidden"}" data-deep-section="week">
      <article class="chart-card">
        <h3>GMV dan Ads per minggu</h3>
        <div id="deep-week-bars" style="margin-top:14px;"></div>
      </article>
      <article class="table-card" style="margin-top:14px;">
        <div class="card-headline">
          <h3>Tabel mingguan</h3>
          <button class="secondary-button compact-button" data-deep-download="week" type="button">Download CSV</button>
        </div>
        ${weeklyTable(weekRows)}
      </article>
    </section>
  `;

  renderHorizontalBars(document.getElementById("deep-outlet-bars"), outletRows.slice(0, 10), "gmv", "cabang");
  renderHorizontalBars(document.getElementById("deep-brand-bars"), brandRows.slice(0, 10), "gmv", "brand");
  renderDonutChart(document.getElementById("deep-brand-donut"), brandRows, "brand");
  renderWeeklyBars(document.getElementById("deep-week-bars"), weekRows);

  el.deepdivePage.querySelectorAll("[data-deep-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.deepDiveTab = button.dataset.deepTab;
      renderDeepDive();
    });
  });
  el.deepdivePage.querySelectorAll("[data-deep-download]").forEach((button) => {
    button.addEventListener("click", () => {
      const type = button.dataset.deepDownload;
      const rows = type === "outlet" ? payload.by_outlet : type === "brand" ? payload.by_brand : payload.by_week;
      downloadCsv(`deepdive-${type}.csv`, rows || []);
    });
  });
  el.deepdivePage.querySelectorAll("[data-deep-sort]").forEach((button) => {
    button.addEventListener("click", () => {
      const [scope, key] = button.dataset.deepSort.split(":");
      const current = state.deepDiveSort[scope];
      state.deepDiveSort[scope] = {
        key,
        direction: current.key === key && current.direction === "desc" ? "asc" : "desc",
      };
      renderDeepDive();
    });
  });
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
        ${animatedValue("strong", "", payload.summary.terima, "currency", "recon:terima")}
        <small>Nett GMV pada baris terfilter</small>
      </article>
      <article class="summary-card">
        <span class="eyebrow">Total Uang Masuk</span>
        ${animatedValue("strong", "", payload.summary.uang_masuk, "currency", "recon:uang_masuk")}
        <small>Cash in aktual yang tercatat</small>
      </article>
      <article class="summary-card">
        <span class="eyebrow">Total Selisih</span>
        ${animatedValue("strong", payload.summary.selisih > 0 ? "cell-negative" : "", payload.summary.selisih, "currency", "recon:selisih")}
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

function renderSyncSummaryLegacy() {
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

function renderSyncSummary() {
  const latest = state.data.syncLogs?.logs?.[0];
  if (!latest) {
    el.syncSummary.textContent = "Belum ada log sinkronisasi.";
    el.syncSummary.removeAttribute("title");
    return;
  }

  const sourceMode = state.data.syncLogs?.source_mode || state.data.kpi?.source_mode || "sample";
  const detail = `Sinkronisasi ${latest.status} pada ${formatDate(latest.started_at)} | ${latest.rows_upserted} baris di-upsert | ${latest.rows_failed} gagal | source ${sourceMode}`;
  el.syncSummary.title = detail;
  el.syncSummary.innerHTML = `
    <div class="sync-badge ${latest.status === "SUCCESS" ? "is-success" : "is-warning"}">${escapeHtml(latest.status)}</div>
    <strong>${escapeHtml(formatDate(latest.started_at))}</strong>
    <span class="sync-mode">${escapeHtml(sourceMode)}</span>
  `;
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
  if (allowedPages().includes("deepdive") && state.data.deepdive) {
    renderDeepDive();
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

  activateValueTransitions(el[`${state.activePage}Page`]);
  playSurfaceEntrance();
}

async function refreshData() {
  if (!state.session) {
    return;
  }

  window.clearTimeout(interactionState.autoRefreshTimer);
  readFiltersFromForm();
  const requestId = ++interactionState.latestRequestId;
  setStatus("Memuat ulang KPI, tren, deep dive, performa brand, cabang, platform, dan rekonsiliasi...");
  showLoadingState();
  setButtonBusy(el.applyFilters, true, "Memuat");
  setToolbarApplying(true);

  try {
    const query = buildQuery(state.filters);
    const requests = [apiFetch(`/api/kpi?${query}`), apiFetch("/api/sync/logs"), apiFetch(`/api/heatmap?${query}`)];
    const pageLoaders = {
      trend: () => apiFetch(`/api/trend/daily?${query}`),
      deepdive: () => apiFetch(`/api/deepdive?${query}`),
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
    if (requestId !== interactionState.latestRequestId) {
      return;
    }
    let cursor = 0;
    state.data.kpi = responses[cursor++];
    state.data.syncLogs = responses[cursor++];
    state.data.heatmap = responses[cursor++];

    if (state.activePage === "trend") {
      state.data.trend = responses[cursor++];
    }
    if (state.activePage === "deepdive") {
      state.data.deepdive = responses[cursor++];
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
    if (requestId !== interactionState.latestRequestId) {
      return;
    }
    reportLoadFailure("refreshData", error);
    throw error;
  } finally {
    if (requestId === interactionState.latestRequestId) {
      clearLoadingState();
      setButtonBusy(el.applyFilters, false);
      setToolbarApplying(false);
    }
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
    setButtonBusy(el.syncButton, true, "Syncing");
    await apiFetch("/api/sync/trigger", {
      method: "POST",
      body: JSON.stringify({ triggered_by: state.session.username }),
    });
    await refreshData();
  } catch (error) {
    reportLoadFailure("handleManualSync", error);
  } finally {
    setButtonBusy(el.syncButton, false);
  }
}

function handleLogout() {
  clearSession();
  el.avatarDropdown?.removeAttribute("open");
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
  document.addEventListener("click", (event) => {
    const detailButton = event.target.closest("[data-kpi-detail]");
    if (detailButton) {
      openKpiDetail(detailButton.dataset.kpiDetail);
    }
  });
  el.syncButton.addEventListener("click", handleManualSync);
  el.logoutButton.addEventListener("click", handleLogout);
  el.applyFilters.addEventListener("click", refreshData);
  el.resetFilters.addEventListener("click", async () => {
    resetFiltersToDefault();
    await refreshData();
  });
  el.startDate.addEventListener("change", scheduleAutoRefresh);
  el.endDate.addEventListener("change", scheduleAutoRefresh);
  el.branchOptions.addEventListener("change", scheduleAutoRefresh);
  el.brandOptions.addEventListener("change", scheduleAutoRefresh);
  el.channelOptions.addEventListener("change", scheduleAutoRefresh);
  el.kpiDetailClose.addEventListener("click", closeKpiDetail);
  el.kpiDetailModal.addEventListener("click", (event) => {
    if (event.target === el.kpiDetailModal) {
      closeKpiDetail();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && el.kpiDetailModal.style.display !== "none") {
      closeKpiDetail();
    }
  });
  document.addEventListener("click", (event) => {
    if (el.branchDropdown && !el.branchDropdown.contains(event.target)) {
      el.branchDropdown.removeAttribute("open");
    }
    if (el.brandDropdown && !el.brandDropdown.contains(event.target)) {
      el.brandDropdown.removeAttribute("open");
    }
    if (el.avatarDropdown && !el.avatarDropdown.contains(event.target)) {
      el.avatarDropdown.removeAttribute("open");
    }
  });

  if ("IntersectionObserver" in window && el.toolbarPanel) {
    const sentinel = document.createElement("div");
    sentinel.className = "toolbar-sentinel";
    el.toolbarPanel.before(sentinel);
    const observer = new IntersectionObserver(
      ([entry]) => {
        el.toolbarPanel.classList.toggle("is-stuck", !entry.isIntersecting);
      },
      { rootMargin: `-${getComputedStyle(document.documentElement).getPropertyValue("--topbar-height").trim()} 0px 0px 0px` }
    );
    observer.observe(sentinel);
  }
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
