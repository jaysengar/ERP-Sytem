import { useId } from 'react';
import { X } from 'lucide-react';
import { categories } from '../domain/types';
import { count } from '../domain/format';
import { Field, SearchInput } from './ui';

interface Props {
  search: string; category: string; brand: string; stock: string; sort: string;
  brands: string[]; total: number; loading: boolean;
  onFilter: (key: string, value: string) => void; onClear: () => void;
}

export function ProductFilters({ search, category, brand, stock, sort, brands, total, loading, onFilter, onClear }: Props) {
  const prefix = useId();
  const active = [
    { key: 'search', label: 'Search', value: search }, { key: 'category', label: 'Category', value: category },
    { key: 'brand', label: 'Brand', value: brand }, { key: 'stock', label: 'Stock', value: stock },
  ].filter(f => f.value);
  return (
    <>
      <div className="catalog-controls">
        <div className="field catalog-search"><div className="field-label"><label htmlFor={`${prefix}-search`}>Search catalogue</label></div><SearchInput id={`${prefix}-search`} value={search} onChange={v => onFilter('search', v)} placeholder="Search name, SKU or barcode…" /></div>
        <Field label="Category"><select id={`${prefix}-category`} aria-label="Filter by category" value={category} onChange={e => onFilter('category', e.target.value)}><option value="">All</option>{category && !categories.some(c => c === category) && <option value={category}>{category} (unavailable)</option>}{categories.map(c => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Brand"><select id={`${prefix}-brand`} aria-label="Filter by brand" value={brand} onChange={e => onFilter('brand', e.target.value)}><option value="">All</option>{brand && !brands.includes(brand) && <option value={brand}>{brand} (unavailable)</option>}{brands.map(b => <option key={b}>{b}</option>)}</select></Field>
        <Field label="Stock status"><select id={`${prefix}-stock`} aria-label="Filter by stock" value={stock} onChange={e => onFilter('stock', e.target.value)}><option value="">All</option><option>In stock</option><option>Low stock</option><option>Out of stock</option></select></Field>
        <Field label="Sort by"><select aria-label="Sort products" value={sort} onChange={e => onFilter('sort', e.target.value)}><option value="name">Name A–Z</option><option value="price-asc">Price: lowest</option><option value="price-desc">Price: highest</option><option value="stock">Stock: lowest</option></select></Field>
      </div>
      <div className="catalog-context">
        <p role="status" aria-atomic="true">{loading ? 'Finding products…' : `${count(total)} ${active.length ? 'matching' : 'total'} products`}</p>
        {active.length > 0 && <div className="active-filters" aria-label="Applied filters">{active.map(f => <button key={f.key} className="filter-chip" aria-label={`Remove ${f.label.toLowerCase()} filter: ${f.value}`} onClick={() => { onFilter(f.key, ''); document.getElementById(`${prefix}-${f.key}`)?.focus(); }}><span>{f.label}: <strong>{f.value}</strong></span><X size={14} aria-hidden="true" /></button>)}<button className="text-link" onClick={() => { onClear(); document.getElementById(`${prefix}-search`)?.focus(); }}>Clear filters</button></div>}
      </div>
    </>
  );
}
