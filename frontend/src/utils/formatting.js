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
export const fmtDollarK = (v) => {
  if (v == null) return '—';
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1000000) return `${sign}$${(abs / 1000000).toLocaleString('en-CA', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}M`;
  if (abs >= 1000) return `${sign}$${(abs / 1000).toLocaleString('en-CA', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}K`;
  return `${sign}$${abs.toLocaleString('en-CA', { maximumFractionDigits: 0 })}`;
};
export const fmtSigned = (v) => {
  if (v == null) return '—';
  const s = v >= 0 ? '+' : '-';
  return `${s}$${Math.abs(v).toLocaleString('en-CA', { maximumFractionDigits: 0 })}`;
};
