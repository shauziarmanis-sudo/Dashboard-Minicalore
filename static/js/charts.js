import { emptyState, escapeHtml, formatCompact, formatCurrency, formatDate } from "./utils.js?v=20260423-1";

function scale(value, max, size) {
  if (!max) {
    return 0;
  }
  return (value / max) * size;
}

function polyline(points) {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

export function renderTrendChart(container, payload) {
  const points = payload?.points || [];
  if (!points.length) {
    container.innerHTML = emptyState("Belum ada data tren", "Ubah filter tanggal untuk melihat data harian.");
    return;
  }

  const width = 920;
  const height = 320;
  const left = 56;
  const right = 18;
  const top = 24;
  const bottom = 56;
  const innerWidth = width - left - right;
  const innerHeight = height - top - bottom;
  const maxValue = Math.max(...points.flatMap((item) => [item.gmv, item.nett_gmv, item.ads]), 1);
  const stepX = points.length > 1 ? innerWidth / (points.length - 1) : innerWidth;

  const gmvPoints = points.map((item, index) => ({
    x: left + index * stepX,
    y: top + innerHeight - scale(item.gmv, maxValue, innerHeight),
  }));
  const nettPoints = points.map((item, index) => ({
    x: left + index * stepX,
    y: top + innerHeight - scale(item.nett_gmv, maxValue, innerHeight),
  }));
  const bars = points
    .map((item, index) => {
      const barWidth = Math.max(6, stepX * 0.42);
      const barHeight = scale(item.ads, maxValue, innerHeight);
      const x = left + index * stepX - barWidth / 2;
      const y = top + innerHeight - barHeight;
      return `<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="8" fill="rgba(195, 139, 45, 0.28)" />`;
    })
    .join("");

  const xLabels = points
    .filter((_, index) => index === 0 || index === points.length - 1 || index % Math.ceil(points.length / 6) === 0)
    .map((item, index) => {
      const x = left + points.indexOf(item) * stepX;
      return `<text x="${x}" y="${height - 18}" text-anchor="${index === 0 ? "start" : "middle"}" fill="#6e5d4b" font-size="12">${escapeHtml(formatDate(item.date, true))}</text>`;
    })
    .join("");

  const averageLine = top + innerHeight - scale(payload.averages?.gmv || 0, maxValue, innerHeight);

  container.innerHTML = `
    <div class="chart-frame">
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Tren GMV harian">
        <line x1="${left}" x2="${width - right}" y1="${top + innerHeight}" y2="${top + innerHeight}" stroke="rgba(32, 24, 16, 0.16)" />
        <line x1="${left}" x2="${width - right}" y1="${averageLine}" y2="${averageLine}" stroke="#6e5d4b" stroke-dasharray="6 6" />
        ${bars}
        <polyline fill="none" stroke="#215540" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" points="${polyline(gmvPoints)}" />
        <polyline fill="none" stroke="#728f71" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" points="${polyline(nettPoints)}" />
        ${gmvPoints
          .map(
            (point) =>
              `<circle cx="${point.x}" cy="${point.y}" r="4" fill="#215540" stroke="#fff8f0" stroke-width="2" />`
          )
          .join("")}
        ${nettPoints
          .map(
            (point) =>
              `<circle cx="${point.x}" cy="${point.y}" r="4" fill="#728f71" stroke="#fff8f0" stroke-width="2" />`
          )
          .join("")}
        ${xLabels}
      </svg>
    </div>
    <div class="legend">
      <span><i style="background:#215540"></i>GMV</span>
      <span><i style="background:#728f71"></i>Nett GMV</span>
      <span><i style="background:#c38b2d"></i>Ads Spend</span>
      <span>Rata-rata GMV: <strong>${formatCurrency(payload.averages?.gmv || 0)}</strong></span>
    </div>
  `;
}

export function renderHorizontalBars(container, rows, key, labelKey) {
  if (!rows?.length) {
    container.innerHTML = emptyState("Tidak ada ranking", "Belum ada data pada kombinasi filter ini.");
    return;
  }

  const maxValue = Math.max(...rows.map((row) => row[key]), 1);
  container.innerHTML = `
    <div class="stack">
      ${rows
        .map((row, index) => {
          const width = scale(row[key], maxValue, 100);
          return `
            <div>
              <div class="summary-inline">
                <strong>${index + 1}. ${escapeHtml(row[labelKey])}</strong>
                <span class="muted">${formatCurrency(row[key])}</span>
              </div>
              <div style="margin-top:10px; height:14px; border-radius:999px; background:rgba(33,85,64,0.08); overflow:hidden;">
                <div style="width:${width}%; height:100%; border-radius:999px; background:linear-gradient(90deg, #215540, #6c8b6e);"></div>
              </div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

export function renderDonutChart(container, rows, labelKey) {
  if (!rows?.length) {
    container.innerHTML = emptyState("Tidak ada kontribusi brand", "Belum ada data brand untuk ditampilkan.");
    return;
  }

  const total = rows.reduce((sum, row) => sum + row.gmv, 0);
  const colors = ["#215540", "#728f71", "#c38b2d", "#8f4f5e", "#467486", "#b45435"];
  let offset = 0;
  const radius = 74;
  const circumference = 2 * Math.PI * radius;

  const arcs = rows
    .map((row, index) => {
      const ratio = total ? row.gmv / total : 0;
      const length = ratio * circumference;
      const segment = `
        <circle
          cx="110"
          cy="110"
          r="${radius}"
          fill="none"
          stroke="${colors[index % colors.length]}"
          stroke-width="26"
          stroke-dasharray="${length} ${circumference - length}"
          stroke-dashoffset="${-offset}"
          stroke-linecap="butt"
          transform="rotate(-90 110 110)"
        />
      `;
      offset += length;
      return segment;
    })
    .join("");

  container.innerHTML = `
    <div class="summary-inline">
      <div class="chart-frame" style="max-width:280px;">
        <svg viewBox="0 0 220 220" role="img" aria-label="Kontribusi brand">
          <circle cx="110" cy="110" r="${radius}" fill="none" stroke="rgba(32,24,16,0.08)" stroke-width="26" />
          ${arcs}
          <text x="110" y="102" text-anchor="middle" fill="#6e5d4b" font-size="13">Total GMV</text>
          <text x="110" y="126" text-anchor="middle" fill="#201810" font-size="16" font-weight="700">${escapeHtml(formatCompact(total))}</text>
        </svg>
      </div>
      <div class="stack" style="width:100%;">
        ${rows
          .map(
            (row, index) => `
              <div class="summary-inline">
                <span><i style="display:inline-block;width:12px;height:12px;border-radius:999px;background:${colors[index % colors.length]};margin-right:8px;"></i>${escapeHtml(row[labelKey])}</span>
                <strong>${row.contribution.toFixed(1)}%</strong>
              </div>
            `
          )
          .join("")}
      </div>
    </div>
  `;
}

export function renderGroupedBars(container, rows) {
  if (!rows?.length) {
    container.innerHTML = emptyState("Tidak ada data platform", "Pilih filter lain untuk melihat perbandingan channel.");
    return;
  }

  const width = 760;
  const height = 320;
  const left = 52;
  const right = 24;
  const top = 24;
  const bottom = 48;
  const innerWidth = width - left - right;
  const innerHeight = height - top - bottom;
  const groupWidth = innerWidth / rows.length;
  const maxValue = Math.max(...rows.flatMap((row) => [row.gmv, row.nett_gmv, row.ads]), 1);
  const series = [
    { key: "gmv", color: "#215540", label: "GMV" },
    { key: "nett_gmv", color: "#728f71", label: "Nett GMV" },
    { key: "ads", color: "#ec7a27", label: "Ads" },
  ];

  const bars = rows
    .map((row, rowIndex) =>
      series
        .map((serie, serieIndex) => {
          const barWidth = groupWidth / 5;
          const x = left + rowIndex * groupWidth + barWidth * (serieIndex + 0.6);
          const barHeight = scale(row[serie.key], maxValue, innerHeight);
          const y = top + innerHeight - barHeight;
          return `<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="8" fill="${serie.color}" />`;
        })
        .join("")
    )
    .join("");

  const labels = rows
    .map((row, index) => {
      const x = left + index * groupWidth + groupWidth / 2;
      return `<text x="${x}" y="${height - 16}" text-anchor="middle" fill="#6e5d4b" font-size="12">${escapeHtml(row.channel)}</text>`;
    })
    .join("");

  container.innerHTML = `
    <div class="chart-frame">
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Perbandingan channel delivery">
        <line x1="${left}" x2="${width - right}" y1="${top + innerHeight}" y2="${top + innerHeight}" stroke="rgba(32,24,16,0.16)" />
        ${bars}
        ${labels}
      </svg>
    </div>
    <div class="legend">
      ${series
        .map((serie) => `<span><i style="background:${serie.color}"></i>${serie.label}</span>`)
        .join("")}
    </div>
  `;
}
