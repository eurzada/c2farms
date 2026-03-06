export function formatCurrency(value, decimals = 2) {
  if (value === null || value === undefined) return '-';
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatNumber(value, decimals = 2) {
  if (value === null || value === undefined) return '-';
  return new Intl.NumberFormat('en-CA', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatPercent(value, decimals = 1) {
  if (value === null || value === undefined) return '-';
  return `${value.toFixed(decimals)}%`;
}

export function currencyParser(value) {
  if (!value) return 0;
  return parseFloat(String(value).replace(/[^0-9.-]/g, '')) || 0;
}

export const fmt = (v, d = 2) => v != null ? v.toLocaleString('en-CA', { maximumFractionDigits: d }) : '—';
export const fmtDollar = (v, d = 2) => v != null ? `$${v.toLocaleString('en-CA', { minimumFractionDigits: d, maximumFractionDigits: d })}` : '—';
export const fmtDollarK = (v) => v != null ? `$${(v / 1000).toFixed(0)}K` : '—';
export const fmtSigned = (v) => {
  if (v == null) return '—';
  const s = v >= 0 ? '+' : '-';
  return `${s}$${Math.abs(v).toLocaleString('en-CA', { maximumFractionDigits: 0 })}`;
};
