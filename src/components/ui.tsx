import { Children, cloneElement, createContext, isValidElement, useContext, useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, ReactElement, ReactNode } from 'react';
import { ArrowLeftRight, ChevronLeft, ChevronRight, Search, X, Package, Shirt, ShoppingBag, AlertTriangle, LoaderCircle } from 'lucide-react';
import type { Product } from '../domain/types';
import { count } from '../domain/format';

export function PageHeader({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return <div className="page-header"><div><h1 tabIndex={-1}>{title}</h1><p>{description}</p></div><div className="actions">{actions}</div></div>;
}
export function Panel({ title, subtitle, action, children, className = '' }: { title?: string; subtitle?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`panel ${className}`}>{title && <div className="panel-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</div>}{children}</section>;
}
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'green' | 'amber' | 'red' | 'blue' | 'neutral' }) { return <span className={`badge ${tone}`}>{children}</span>; }
export function Status({ value }: { value: string }) { return <Badge tone={['Paid', 'Received', 'In stock', 'Active'].includes(value) ? 'green' : ['Low stock', 'Ordered', 'Partial'].includes(value) ? 'amber' : ['Out of stock', 'Unpaid', 'Inactive'].includes(value) ? 'red' : 'neutral'}>{value}</Badge>; }
export function Empty({ title = 'No results found', description = 'Try a different search or clear your filters.', action }: { title?: string; description?: string; action?: ReactNode }) { return <div className="empty"><Package size={30} strokeWidth={1.5} /><h3>{title}</h3><p>{description}</p>{action}</div>; }
export function SearchInput({ value, onChange, placeholder = 'Search…', label, id }: { value: string; onChange: (value: string) => void; placeholder?: string; label?: string; id?: string }) { return <div className="search-field"><Search size={17} aria-hidden="true" /><input id={id} aria-label={label || placeholder} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />{value && <button type="button" aria-label="Clear search" onClick={() => { onChange(''); if (id) document.getElementById(id)?.focus(); }}><X size={15} /></button>}</div>; }
type FieldIssue = { label: string; message: string };
const FormIssues = createContext<Record<string, FieldIssue>>({});
type ControlProps = { id?: string; required?: boolean; 'aria-describedby'?: string; 'aria-invalid'?: boolean };

export function Field({ label, children, hint, error: externalError, className = '' }: { label: string; children: ReactNode; hint?: string; error?: string; className?: string }) {
  const generatedId = useId();
  const child = Children.only(children);
  const control = isValidElement<ControlProps>(child) ? child : null;
  const id = control?.props.id || generatedId;
  const error = useContext(FormIssues)[id]?.message || externalError;
  const describedBy = [control?.props['aria-describedby'], hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ');
  return (
    <div className={`field ${error ? 'has-error' : ''} ${className}`}>
      <div className="field-label"><label htmlFor={id}>{label}</label>{control?.props.required && <span className="required-mark" aria-hidden="true">*</span>}</div>
      {control ? cloneElement(control as ReactElement<ControlProps>, { id, 'aria-describedby': describedBy || undefined, 'aria-invalid': !!error || control.props['aria-invalid'] }) : children}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
      {error && <small id={`${id}-error`} className="field-error">{error}</small>}
    </div>
  );
}
export function Dialog({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null); const id = useId();
  useEffect(() => { const dialog = ref.current!; const previous = document.activeElement as HTMLElement | null; dialog.showModal(); const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { dialog.close(); document.body.style.overflow = overflow; previous?.focus(); }; }, []);
  return <dialog ref={ref} className={`modal ${wide ? 'wide' : ''}`} aria-labelledby={id} onCancel={onClose}><div className="modal-heading no-print"><h2 id={id}>{title}</h2><button type="button" className="icon-btn" aria-label="Close dialog" onClick={onClose}><X size={20} /></button></div><div className="modal-body">{children}</div></dialog>;
}
export function Form({ children, onSubmit, submitLabel = 'Save changes', onCancel, className = '' }: { children: ReactNode; onSubmit: (data: FormData) => Promise<void>; submitLabel?: string; onCancel?: () => void; className?: string }) {
  const [error, setError] = useState('');
  const [issues, setIssues] = useState<Record<string, FieldIssue>>({});
  const [busy, setBusy] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);

  function focusField(id: string) {
    const control = document.getElementById(id);
    let parent = control?.parentElement;
    while (parent) { if (parent instanceof HTMLDetailsElement) parent.open = true; parent = parent.parentElement; }
    requestAnimationFrame(() => control?.focus());
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (inFlight.current) return;
    const form = e.currentTarget;
    const invalid: Record<string, FieldIssue> = {};
    Array.from(form.elements).forEach((element, index) => {
      if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) || !element.willValidate || element.validity.valid) return;
      if (!element.id) element.id = `invalid-field-${index}`;
      const label = element.labels?.[0]?.textContent?.replace(/\s*\*$/, '').trim() || element.getAttribute('aria-label') || element.name || 'Field';
      invalid[element.id] = { label, message: element.validity.valueMissing ? 'This field is required.' : element.validationMessage };
    });
    setIssues(invalid);
    setError('');
    if (Object.keys(invalid).length) { requestAnimationFrame(() => errorRef.current?.focus()); return; }
    const data = new FormData(form);
    inFlight.current = true;
    setBusy(true);
    try { await onSubmit(data); }
    catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally { inFlight.current = false; setBusy(false); }
  }

  return (
    <FormIssues.Provider value={issues}>
      <form noValidate onSubmit={submit} className={className} aria-busy={busy} onInput={e => {
        const control = e.target;
        if ((control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement) && control.validity.valid && issues[control.id]) {
          setIssues(previous => { const next = { ...previous }; delete next[control.id]; return next; });
        }
      }}>
        {(error || Object.keys(issues).length > 0) && (
          <div className="form-error" role="alert" tabIndex={-1} ref={errorRef}>
            <AlertTriangle size={18} aria-hidden="true" />
            <div>{error || 'Check the highlighted fields to continue.'}
              {Object.keys(issues).length > 0 && <ul>{Object.entries(issues).map(([id, issue]) => <li key={id}><button type="button" onClick={() => focusField(id)}>{issue.label}</button></li>)}</ul>}
            </div>
          </div>
        )}
        {children}
        <div className="form-footer">
          {onCancel && <button type="button" className="btn" disabled={busy} onClick={onCancel}>Cancel</button>}
          <button type="submit" className="btn primary" disabled={busy}>{busy && <LoaderCircle size={16} className="spin" />}{busy ? 'Saving…' : submitLabel}</button>
        </div>
      </form>
    </FormIssues.Provider>
  );
}
export function Confirm({ title, description, onConfirm, onClose, label = 'Confirm', danger = false }: { title: string; description: ReactNode; onConfirm: () => Promise<void>; onClose: () => void; label?: string; danger?: boolean }) { return <Dialog title={title} onClose={onClose}><div className={danger ? 'confirm danger' : 'confirm'}><Form onSubmit={onConfirm} submitLabel={label} onCancel={onClose}><p>{description}</p></Form></div></Dialog>; }
export function Pagination({ total, page, pageSize, onChange }: { total: number; page: number; pageSize: number; onChange: (page: number) => void }) { const pages = Math.max(1, Math.ceil(total / pageSize)); return <div className="pagination"><span>{total ? `${count((page - 1) * pageSize + 1)}–${count(Math.min(page * pageSize, total))} of ${count(total)}` : '0 results'}</span><div><button className="icon-btn" disabled={page <= 1} aria-label="Previous page" onClick={() => onChange(page - 1)}><ChevronLeft size={18} /></button><span>Page {page} of {pages}</span><button className="icon-btn" disabled={page >= pages} aria-label="Next page" onClick={() => onChange(page + 1)}><ChevronRight size={18} /></button></div></div>; }
export function ProductThumb({ product, large = false }: { product: Product; large?: boolean }) { const [failed, setFailed] = useState(false); useEffect(() => setFailed(false), [product.image]); return <span className={`product-thumb ${large ? 'large' : ''} tone-${['Shirts', 'T-Shirts', 'Jeans', 'Trousers', 'Kurtis', 'Sarees', 'Suits', 'Kids Wear', 'Accessories'].indexOf(product.category) % 5}`}>{product.image && !failed ? <img src={product.image} alt={`${product.name} in ${product.colour}`} loading="lazy" onError={() => setFailed(true)} /> : product.category === 'Accessories' ? <ShoppingBag size={large ? 42 : 23} strokeWidth={1.3} aria-hidden="true" /> : <Shirt size={large ? 45 : 24} strokeWidth={1.3} aria-hidden="true" />}</span>; }
export function TableWrap({ children, label = 'Data table' }: { children: ReactNode; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  const hintId = useId();
  useEffect(() => {
    const container = ref.current!;
    const check = () => setOverflow(container.scrollWidth > container.clientWidth + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(container);
    if (container.firstElementChild) observer.observe(container.firstElementChild);
    return () => observer.disconnect();
  }, []);
  return <div className="table-container"><div ref={ref} className="table-scroll" role="region" aria-label={label} aria-describedby={overflow ? hintId : undefined} tabIndex={overflow ? 0 : undefined}><table>{children}</table></div>{overflow && <p id={hintId} className="table-scroll-hint no-print"><ArrowLeftRight size={14} aria-hidden="true" />Scroll sideways for more columns</p>}</div>;
}
export const textValue = (data: FormData, name: string) => String(data.get(name) || '').trim();
export const numberValue = (data: FormData, name: string) => Number(data.get(name));
