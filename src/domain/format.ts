export const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2, minimumFractionDigits: Number.isInteger(value) ? 0 : 2 }).format(value);
export const count = (value: number) => new Intl.NumberFormat('en-IN').format(value);
export const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
export const dateKey = (value: string | Date = new Date()) => { const d = new Date(value); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const dateLabel = (value: string, time = false) => new Date(value).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', ...(time ? { hour: '2-digit', minute: '2-digit' } as const : {}) });
export const sum = <T,>(items: T[], fn: (item: T) => number) => round(items.reduce((total, item) => total + fn(item), 0));
export const uid = () => crypto.randomUUID();
export function downloadCsv(name: string, rows: (string | number)[][]) {
  const csv = '\ufeff' + rows.map(row => row.map(value => { let s = String(value); if (/^[=+@\-\t\r]/.test(s)) s = "'" + s; return '"' + s.replaceAll('"', '""') + '"'; }).join(',')).join('\r\n');
  downloadFile(name, csv, 'text/csv;charset=utf-8');
}
export function downloadFile(name: string, content: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
