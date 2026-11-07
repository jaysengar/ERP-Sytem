import type { Product } from './types';
import { uid } from './format';
export const productColumns = ['name', 'sku', 'barcode', 'category', 'brand', 'size', 'colour', 'purchasePrice', 'sellingPrice', 'quantity', 'minStock', 'image', 'styleId'] as const;
export function productCsvRows(products: Product[]) { return [Array.from(productColumns), ...products.map(p => productColumns.map(key => p[key]))]; }
export function parseProductCsv(content: string): Product[] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false;
  const input = content.replace(/^\ufeff/, '');
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '"') { if (quoted && input[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (c === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) { if (c === '\r' && input[i + 1] === '\n') i++; row.push(cell); if (row.some(v => v.trim())) rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (quoted) throw new Error('The CSV contains an unclosed quote. Check your file and try again.');
  row.push(cell); if (row.some(v => v.trim())) rows.push(row);
  if (rows.length < 2) throw new Error('The CSV must include a header and at least one product.');
  if (rows.length > 501) throw new Error('Import up to 500 products at a time in this demo.');
  const headers = rows.shift()!.map(h => h.trim());
  if (!productColumns.slice(0, 11).every(c => headers.includes(c))) throw new Error('CSV columns do not match. Download the template to see the required columns.');
  return rows.map((r, index) => { if (r.length !== headers.length) throw new Error(`Row ${index + 2} has the wrong number of columns.`); const values = Object.fromEntries(headers.map((h, i) => [h, r[i].trim()])); for (const key of productColumns.slice(0, 11)) { if (!values[key]) throw new Error(`Row ${index + 2}: ${key} is required.`); } const p = values as unknown as Product; return { ...p, id: uid(), styleId: p.styleId || uid(), image: p.image || '', purchasePrice: Number(p.purchasePrice), sellingPrice: Number(p.sellingPrice), quantity: Number(p.quantity), minStock: Number(p.minStock) }; });
}
