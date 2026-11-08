import type { CheckoutInput, Database, Expense, Permission, Product, ProductQuery, Purchase, Role, Settings, Staff, Supplier } from './types';
import { can, categories } from './types';
import { dateKey, round, sum, uid } from './format';

export function requirePermission(role: Role, action: Permission) { if (!can(role, action)) throw new Error('Your role does not have permission for this action.'); }
function amount(n: number, label: string, positive = false) { if (!Number.isFinite(n) || n < (positive ? 0.01 : 0) || n > 1e9) throw new Error(`${label} must be ${positive ? 'greater than zero' : 'zero or more'} and below ₹100 crore.`); if (Math.abs(n * 100 - Math.round(n * 100)) > 0.00001) throw new Error(`${label} can have at most two decimal places.`); }
function quantity(n: number, label = 'Quantity', zero = false) { if (!Number.isSafeInteger(n) || n < (zero ? 0 : 1) || n > 1e6) throw new Error(`${label} must be a whole number ${zero ? 'from 0' : 'from 1'} to 10,00,000.`); }
function required(value: string, label: string) { if (!value.trim()) throw new Error(`${label} is required.`); }
function mobile(value: string, optional = false) { if ((!optional || value) && !/^[6-9]\d{9}$/.test(value)) throw new Error('Enter a valid 10-digit Indian mobile number.'); }
function validDate(value: string) { if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(new Date(`${value}T12:00:00`).getTime()) || dateKey(`${value}T12:00:00`) !== value) throw new Error('Choose a valid date.'); }
export function stockStatus(product: Product) { return product.quantity === 0 ? 'Out of stock' : product.quantity <= product.minStock ? 'Low stock' : 'In stock'; }
export function queryProducts(db: Database, query: ProductQuery) {
  const search = (query.search || '').toLowerCase().trim();
  const items = db.products.filter(p => (!search || `${p.name} ${p.sku} ${p.barcode} ${p.size} ${p.colour}`.toLowerCase().includes(search)) && (!query.category || p.category === query.category) && (!query.brand || p.brand === query.brand) && (!query.stock || (query.stock === 'Low stock' ? p.quantity <= p.minStock : stockStatus(p) === query.stock)));
  items.sort((a, b) => query.sort === 'price-desc' ? b.sellingPrice - a.sellingPrice : query.sort === 'price-asc' ? a.sellingPrice - b.sellingPrice : query.sort === 'stock' ? a.quantity - b.quantity : a.name.localeCompare(b.name) || a.sku.localeCompare(b.sku));
  const pageSize = Math.max(1, Math.min(100, query.pageSize || 12)); const page = Math.max(1, Math.min(query.page || 1, Math.ceil(items.length / pageSize) || 1));
  return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, pageSize };
}
export function saveProduct(db: Database, role: Role, product: Product) {
  requirePermission(role, 'products'); required(product.name, 'Product name'); required(product.sku, 'SKU'); required(product.barcode, 'Barcode'); required(product.brand, 'Brand'); required(product.size, 'Size'); required(product.colour, 'Colour');
  if (!categories.includes(product.category)) throw new Error('Choose a clothing category.');
  amount(product.purchasePrice, 'Purchase price'); amount(product.sellingPrice, 'Selling price', true); quantity(product.quantity, 'Stock', true); quantity(product.minStock, 'Minimum stock', true);
  if (product.image && !/^https?:\/\//.test(product.image) && !/^\/products\/[\w.-]+$/.test(product.image)) throw new Error('Use an http or https image URL.');
  if (db.products.some(p => p.id !== product.id && (p.sku.toLowerCase() === product.sku.toLowerCase() || p.barcode === product.barcode))) throw new Error('Another product already uses this SKU or barcode.');
  const existing = db.products.find(p => p.id === product.id);
  if (existing) { Object.assign(existing, { ...product, quantity: existing.quantity }); }
  else { db.products.push(product); if (product.quantity) db.movements.unshift({ id: uid(), productId: product.id, date: new Date().toISOString(), change: product.quantity, reason: 'Opening stock', reference: product.sku }); }
}
export function removeProduct(db: Database, role: Role, id: string) {
  requirePermission(role, 'delete');
  if (db.purchases.some(p => p.status === 'Ordered' && p.lines.some(l => l.productId === id))) throw new Error('This product is on an open purchase order. Receive the order before deleting it.');
  db.products = db.products.filter(p => p.id !== id);
}
export function adjustStock(db: Database, role: Role, productId: string, change: number, reason: string) {
  requirePermission(role, 'products'); required(reason, 'Reason');
  if (!Number.isSafeInteger(change) || change === 0) throw new Error('Enter a non-zero whole number for the stock change.');
  const p = db.products.find(p => p.id === productId); if (!p) throw new Error('Product no longer exists.');
  quantity(p.quantity + change, 'Resulting stock', true); p.quantity += change;
  db.movements.unshift({ id: uid(), productId, date: new Date().toISOString(), change, reason, reference: 'Manual adjustment' });
}
export function calculateBill(subtotal: number, discount: number, taxRate: number) { const tax = round((subtotal - discount) * taxRate / 100); return { tax, total: round(subtotal - discount + tax) }; }
export function checkout(db: Database, role: Role, input: CheckoutInput) {
  requirePermission(role, 'sell'); if (!input.lines.length) throw new Error('Add at least one product to the bill.');
  amount(input.discount, 'Discount'); mobile(input.mobile, true);
  if (!['Cash', 'UPI', 'Card', 'Other'].includes(input.paymentMethod)) throw new Error('Choose a payment method.');
  const merged = new Map<string, number>(); input.lines.forEach(l => { quantity(l.quantity); merged.set(l.productId, (merged.get(l.productId) || 0) + l.quantity); });
  const lines = [...merged].map(([id, qty]) => {
    const p = db.products.find(item => item.id === id); if (!p) throw new Error('A product in this bill was removed. Please refresh your cart.');
    if (qty > p.quantity) throw new Error(`Only ${p.quantity} pieces of ${p.name} (${p.size}, ${p.colour}) are available.`);
    return { productId: p.id, name: p.name, sku: p.sku, size: p.size, colour: p.colour, quantity: qty, price: p.sellingPrice, cost: p.purchasePrice };
  });
  const subtotal = sum(lines, l => l.price * l.quantity); if (input.discount > subtotal) throw new Error('Discount cannot be greater than the subtotal.');
  let customer = input.mobile ? db.customers.find(c => c.mobile === input.mobile) : undefined;
  if (input.mobile && !customer) { customer = { id: uid(), name: input.customerName.trim() || 'Customer', mobile: input.mobile }; db.customers.push(customer); }
  const s = db.settings; const taxRate = s.gstEnabled ? s.taxRate : 0;
  let sequence = db.sales.length + 1; while (db.sales.some(sale => sale.invoice === `${s.invoicePrefix}-${String(sequence).padStart(5, '0')}`)) sequence++;
  const invoice = `${s.invoicePrefix}-${String(sequence).padStart(5, '0')}`; const date = new Date().toISOString();
  const sale = { id: uid(), invoice, date, customerId: customer?.id, customerName: input.customerName.trim() || customer?.name || 'Walk-in customer', mobile: input.mobile, lines, subtotal, discount: round(input.discount), taxRate, ...calculateBill(subtotal, input.discount, taxRate), paymentMethod: input.paymentMethod, paymentStatus: 'Paid' as const, shop: { name: s.shopName, address: s.address, phone: s.phone, gstin: s.gstEnabled ? s.gstin : '', footer: s.invoiceFooter } };
  lines.forEach(l => { db.products.find(p => p.id === l.productId)!.quantity -= l.quantity; db.movements.unshift({ id: uid(), productId: l.productId, date, change: -l.quantity, reason: 'Sale', reference: invoice }); }); db.sales.push(sale); return sale;
}
export function saveSupplier(db: Database, role: Role, supplier: Supplier) {
  requirePermission(role, 'purchase'); required(supplier.name, 'Supplier name'); required(supplier.contact, 'Contact name'); mobile(supplier.mobile);
  if (supplier.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supplier.email)) throw new Error('Enter a valid supplier email.'); db.suppliers.push(supplier);
}
export function createPurchase(db: Database, role: Role, purchase: Purchase) {
  requirePermission(role, 'purchase'); validDate(purchase.date);
  if (!db.suppliers.some(s => s.id === purchase.supplierId)) throw new Error('Select a supplier.');
  if (!purchase.lines.length) throw new Error('Add at least one purchase item.');
  if (!['Paid', 'Unpaid', 'Partial'].includes(purchase.paymentStatus)) throw new Error('Choose payment status.');
  const ids = new Set<string>(); purchase.lines.forEach(l => { if (!db.products.some(p => p.id === l.productId)) throw new Error('A product no longer exists.'); if (ids.has(l.productId)) throw new Error('Combine duplicate purchase lines.'); ids.add(l.productId); quantity(l.quantity); amount(l.cost, 'Purchase price', true); });
  db.purchases.unshift({ ...purchase, status: 'Ordered', receivedAt: undefined, total: sum(purchase.lines, l => l.quantity * l.cost) });
}
export function receivePurchase(db: Database, role: Role, id: string) {
  requirePermission(role, 'purchase'); const order = db.purchases.find(p => p.id === id); if (!order) throw new Error('Purchase not found.'); if (order.status === 'Received') throw new Error('This purchase has already been received. Stock has not been added again.');
  order.lines.forEach(l => { const p = db.products.find(p => p.id === l.productId); if (!p) throw new Error(`Product ${l.sku} no longer exists.`); quantity(p.quantity + l.quantity, 'Resulting stock', true); });
  const date = new Date().toISOString(); order.lines.forEach(l => { const p = db.products.find(p => p.id === l.productId)!; p.purchasePrice = round((p.purchasePrice * p.quantity + l.cost * l.quantity) / (p.quantity + l.quantity)); p.quantity += l.quantity; db.movements.unshift({ id: uid(), productId: p.id, date, change: l.quantity, reason: 'Purchase received', reference: order.reference }); }); order.status = 'Received'; order.receivedAt = date;
}
export function saveExpense(db: Database, role: Role, expense: Expense) { requirePermission(role, 'expenses'); amount(expense.amount, 'Expense amount', true); required(expense.category, 'Category'); required(expense.description, 'Description'); validDate(expense.date); db.expenses.unshift(expense); }
export function saveStaff(db: Database, role: Role, staff: Staff) {
  requirePermission(role, 'staff'); required(staff.name, 'Staff name'); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(staff.email)) throw new Error('Enter a valid staff email.'); if (!['Owner / Admin', 'Cashier', 'Inventory Manager'].includes(staff.role)) throw new Error('Choose a role.');
  if (db.staff.some(s => s.id !== staff.id && s.email.toLowerCase() === staff.email.toLowerCase())) throw new Error('A staff member already uses this email.');
  const existing = db.staff.find(s => s.id === staff.id);
  if (existing?.role === 'Owner / Admin' && existing.active && (!staff.active || staff.role !== 'Owner / Admin') && db.staff.filter(s => s.role === 'Owner / Admin' && s.active).length === 1) throw new Error('Keep at least one active owner.');
  if (existing) Object.assign(existing, staff); else db.staff.push(staff);
}
export function saveSettings(db: Database, role: Role, settings: Settings) {
  requirePermission(role, 'settings'); required(settings.shopName, 'Shop name'); required(settings.address, 'Shop address'); required(settings.phone, 'Shop contact number'); required(settings.profileName, 'Profile name');
  if (!/^[A-Za-z0-9-]{1,10}$/.test(settings.invoicePrefix)) throw new Error('Invoice prefix must contain 1–10 letters, numbers or hyphens.');
  quantity(settings.lowStockThreshold, 'Default low stock level', true);
  if (!Number.isFinite(settings.taxRate) || settings.taxRate < 0 || settings.taxRate > 28) throw new Error('GST rate must be between 0% and 28%.');
  if (settings.gstEnabled && !/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/.test(settings.gstin)) throw new Error('Enter a valid 15-character GSTIN or turn off GST.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.profileEmail)) throw new Error('Enter a valid profile email.'); db.settings = settings;
}
