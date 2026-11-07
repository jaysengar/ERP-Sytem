import { ChevronRight, Eye } from 'lucide-react';
import type { Sale } from '../domain/types';
import { dateLabel, money, sum } from '../domain/format';
import { Empty, Status, TableWrap } from './ui';
export function SalesTable({ sales, onView, compact = false }: { sales: Sale[]; onView: (sale: Sale) => void; compact?: boolean }) {
  if (!sales.length) return <Empty title="No sales to show" description="Complete a bill in POS to see it here." />;
  return (
    <div className={`sales-records ${compact ? 'compact' : ''}`}>
      <div className="sales-desktop">
        <TableWrap label="Sales invoices">
          <thead><tr><th>Invoice</th><th>Customer</th>{!compact && <th>Items</th>}<th>Payment</th><th className="numeric">Amount</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{sales.map(s => (
            <tr key={s.id}>
              <td><button className="text-link" onClick={() => onView(s)}>{s.invoice}</button><small>{dateLabel(s.date, true)}</small></td>
              <td><strong>{s.customerName}</strong>{!compact && <small>{s.mobile || 'No mobile provided'}</small>}</td>
              {!compact && <td>{sum(s.lines, l => l.quantity)} pieces<small>{s.lines.length} {s.lines.length === 1 ? 'product' : 'products'}</small></td>}
              <td>{s.paymentMethod}</td><td className="numeric strong">{money(s.total)}</td><td><Status value={s.paymentStatus} /></td>
              <td><button className="icon-btn" aria-label={`View invoice ${s.invoice}`} onClick={() => onView(s)}><Eye size={17} /></button></td>
            </tr>
          ))}</tbody>
        </TableWrap>
      </div>
      <div className="sales-mobile" aria-label="Sales invoices">
        {sales.map(s => (
          <button className="sale-summary" key={s.id} aria-label={`View invoice ${s.invoice}`} onClick={() => onView(s)}>
            <span className="sale-summary-top"><strong>{s.customerName}</strong><b>{money(s.total)}</b></span>
            <span className="sale-summary-meta"><span>{s.invoice} · {s.paymentMethod}</span><Status value={s.paymentStatus} /></span>
            <span className="sale-summary-date">{dateLabel(s.date, true)}<ChevronRight size={16} aria-hidden="true" /></span>
          </button>
        ))}
      </div>
    </div>
  );
}
