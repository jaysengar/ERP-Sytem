import { randomUUID } from 'node:crypto';
import { adjustStock, checkout, createPurchase, receivePurchase, removeProduct, saveExpense, saveProduct, saveSettings, saveStaff, saveSupplier } from '../src/domain/transactions.ts';
import { can } from '../src/domain/types.ts';
import { ApiError } from './security.mjs';

export const commandPermissions = {
  'product.save': 'products', 'product.import': 'products', 'product.delete': 'delete', 'stock.adjust': 'products',
  'sale.create': 'sell', 'supplier.create': 'purchase', 'purchase.create': 'purchase', 'purchase.receive': 'purchase',
  'purchase.payment': 'purchase', 'expense.create': 'expenses', 'staff.save': 'staff', 'settings.save': 'settings',
};
function object(value) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'Send a valid record.'); return value; }
function strings(value, fields, max = 500) { for (const field of fields.split(' ')) if (typeof value[field] !== 'string' || value[field].length > max) throw new ApiError(400, `Invalid ${field}.`); }
function numbers(value, fields) { for (const field of fields.split(' ')) if (typeof value[field] !== 'number' || !Number.isFinite(value[field])) throw new ApiError(400, `Invalid ${field}.`); }
function boolean(value, field) { if (typeof value[field] !== 'boolean') throw new ApiError(400, `Invalid ${field}.`); }
function id(value, field = 'id') { strings(value, field, 100); if (!/^[\w-]{1,100}$/.test(value[field])) throw new ApiError(400, `Invalid ${field}.`); }
function lines(value) { if (!Array.isArray(value) || !value.length || value.length > 500) throw new ApiError(400, 'Include between 1 and 500 items.'); value.forEach(object); }
function product(value) { object(value); id(value); strings(value, 'styleId name sku barcode category brand size colour image', 2000); numbers(value, 'purchasePrice sellingPrice quantity minStock'); }
function unique(db, kind, value) { if (db[kind].some(item => item.id === value.id)) throw new ApiError(409, 'This record already exists.'); }
export function validateCommand(type, raw) {
  if (!Object.hasOwn(commandPermissions, type)) throw new ApiError(400, 'Unknown store action.');
  const input = object(raw);
  switch (type) {
    case 'product.save': product(input); break;
    case 'product.import': lines(input.products); input.products.forEach(product); break;
    case 'product.delete': case 'purchase.receive': id(input); break;
    case 'stock.adjust': id(input, 'productId'); numbers(input, 'change'); strings(input, 'reason'); break;
    case 'sale.create':
      lines(input.lines); input.lines.forEach(line => { id(line, 'productId'); numbers(line, 'quantity'); });
      numbers(input, 'discount'); strings(input, 'customerName mobile paymentMethod'); break;
    case 'supplier.create': id(input); strings(input, 'name contact mobile email address'); break;
    case 'purchase.create':
      id(input); id(input, 'supplierId'); strings(input, 'date paymentStatus'); lines(input.lines);
      input.lines.forEach(line => { id(line, 'productId'); numbers(line, 'quantity cost'); }); break;
    case 'purchase.payment': id(input); strings(input, 'paymentStatus'); break;
    case 'expense.create': id(input); strings(input, 'category date description'); numbers(input, 'amount'); break;
    case 'staff.save': id(input); strings(input, 'name email role'); boolean(input, 'active'); break;
    case 'settings.save':
      strings(input, 'shopName address phone invoicePrefix invoiceFooter gstin profileName profileEmail');
      numbers(input, 'taxRate lowStockThreshold'); boolean(input, 'gstEnabled'); break;
  }
  return input;
}
export function execute(db, actor, type, input) {
  if (!can(actor.role, commandPermissions[type])) throw new ApiError(403, 'Your account does not have permission for this action.');
  const role = actor.role;
  switch (type) {
    case 'product.save': saveProduct(db, role, input); break;
    case 'product.delete': removeProduct(db, role, input.id); break;
    case 'product.import': input.products.forEach((item, i) => { unique(db, 'products', item); try { saveProduct(db, role, item); } catch (e) { throw new ApiError(400, `Row ${i + 2}: ${e.message}`); } }); break;
    case 'stock.adjust': adjustStock(db, role, input.productId, input.change, input.reason); break;
    case 'sale.create': return checkout(db, role, input);
    case 'supplier.create': unique(db, 'suppliers', input); saveSupplier(db, role, input); break;
    case 'purchase.create': {
      unique(db, 'purchases', input);
      const order = { ...input, reference: `PO-${randomUUID().slice(0, 8).toUpperCase()}`, lines: input.lines.map(line => {
        const p = db.products.find(p => p.id === line.productId);
        if (!p) throw new ApiError(400, 'A product no longer exists.');
        return { productId: p.id, name: p.name, sku: p.sku, quantity: line.quantity, cost: line.cost };
      }) };
      createPurchase(db, role, order); break;
    }
    case 'purchase.receive': receivePurchase(db, role, input.id); break;
    case 'purchase.payment': {
      if (!['Paid', 'Unpaid', 'Partial'].includes(input.paymentStatus)) throw new ApiError(400, 'Choose a valid payment status.');
      const order = db.purchases.find(p => p.id === input.id); if (!order) throw new ApiError(404, 'Order not found.');
      order.paymentStatus = input.paymentStatus; break;
    }
    case 'expense.create': unique(db, 'expenses', input); saveExpense(db, role, input); break;
    case 'staff.save': {
      const { id, name, email, role: staffRole, active } = input;
      if (id === actor.id && (!active || staffRole !== 'Owner / Admin')) throw new ApiError(400, 'Use another owner account to change your own access.');
      saveStaff(db, role, { id, name, email: email.toLowerCase().trim(), role: staffRole, active }); break;
    }
    case 'settings.save': saveSettings(db, role, input); break;
  }
  return null;
}
export function visibleProduct(product, role) { return can(role, 'products') ? product : { ...product, purchasePrice: 0 }; }
export function visibleSale(sale, role) { return can(role, 'reports') ? sale : { ...sale, lines: sale.lines.map(line => ({ ...line, cost: null })) }; }
export function visibleState(db, user) {
  if (user.role === 'Owner / Admin') return db;
  return { ...db, products: db.products.map(p => visibleProduct(p, user.role)), sales: db.sales.map(s => visibleSale(s, user.role)),
    purchases: can(user.role, 'purchase') ? db.purchases : [], suppliers: can(user.role, 'purchase') ? db.suppliers : [],
    movements: can(user.role, 'products') ? db.movements : [], expenses: [], staff: [user],
    settings: { ...db.settings, profileName: user.name, profileEmail: user.email },
  };
}
