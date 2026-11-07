import type { Database, Sale } from './types';
import { dateKey, round, sum } from './format';
export function salesInRange(sales: Sale[], from: string, to: string) { return sales.filter(s => (!from || dateKey(s.date) >= from) && (!to || dateKey(s.date) <= to)); }
export function dailySeries(sales: Sale[], days: number, now = new Date()) { return Array.from({ length: days }, (_, i) => { const d = new Date(now); d.setDate(d.getDate() - (days - 1 - i)); const key = dateKey(d); const items = sales.filter(s => dateKey(s.date) === key); return { date: key, label: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), sales: sum(items, s => s.total - s.tax), orders: items.length }; }); }
export function productSales(sales: Sale[]) {
  const map = new Map<string, { id: string; name: string; sku: string; quantity: number; revenue: number; grossProfit: number; knownCostUnits: number }>();
  sales.forEach(s => s.lines.forEach(l => { const entry = map.get(l.productId) || { id: l.productId, name: l.name, sku: l.sku, quantity: 0, revenue: 0, grossProfit: 0, knownCostUnits: 0 }; const revenue = l.price * l.quantity * (s.subtotal ? 1 - s.discount / s.subtotal : 0); entry.quantity += l.quantity; entry.revenue += revenue; if (l.cost !== null) { entry.grossProfit += revenue - l.cost * l.quantity; entry.knownCostUnits += l.quantity; } map.set(l.productId, entry); }));
  return [...map.values()].map(e => ({ ...e, revenue: round(e.revenue), grossProfit: round(e.grossProfit) })).sort((a, b) => b.quantity - a.quantity);
}
export function customerSummary(db: Database, id: string) { const sales = db.sales.filter(s => s.customerId === id).sort((a, b) => b.date.localeCompare(a.date)); return { sales, total: sum(sales, s => s.total), orders: sales.length, last: sales[0]?.date }; }
