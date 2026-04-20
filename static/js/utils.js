const currencyFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

const percentFormatter = new Intl.NumberFormat("id-ID", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const dateFormatter = new Intl.DateTimeFormat("id-ID", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const shortDateFormatter = new Intl.DateTimeFormat("id-ID", {
  day: "2-digit",
  month: "short",
});

export function formatCurrency(value) {
  return currencyFormatter.format(Number(value || 0));
}

export function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "N/A";
  }
  return `${percentFormatter.format(Number(value))}%`;
}

export function formatSignedPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "vs periode sebelumnya";
  }
  const prefix = Number(value) > 0 ? "+" : "";
  return `${prefix}${percentFormatter.format(Number(value))}% vs periode sebelumnya`;
}

export function formatDate(value, short = false) {
  const parsed = new Date(value);
  return (short ? shortDateFormatter : dateFormatter).format(parsed);
}

export function formatCompact(value) {
  return new Intl.NumberFormat("id-ID", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Number(value || 0));
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function buildQuery(filters, extra = {}) {
  const params = new URLSearchParams();
  params.set("start", filters.start);
  params.set("end", filters.end);

  ["cabang", "brand", "channel"].forEach((key) => {
    filters[key].forEach((value) => params.append(key, value));
  });

  Object.entries(extra).forEach(([key, value]) => {
    params.set(key, String(value));
  });

  return params.toString();
}

export function downloadCsv(filename, rows) {
  if (!rows.length) {
    return;
  }

  const headers = Object.keys(rows[0]);
  const csvRows = [
    headers.join(","),
    ...rows.map((row) =>
      headers
        .map((header) => {
          const raw = row[header] ?? "";
          const escaped = String(raw).replaceAll('"', '""');
          return `"${escaped}"`;
        })
        .join(",")
    ),
  ];

  const blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

export function deltaClass(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return Number(value) >= 0 ? "positive" : "negative";
}

export function emptyState(title, copy) {
  return `<div class="empty-state"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(copy)}</p></div>`;
}
