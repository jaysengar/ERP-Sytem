import type { CheckoutInput, Expense, Product, Purchase, Sale, Settings, Staff, Supplier } from './types';

// Only explicit, serializable commands cross the API boundary. Roles, prices,
// totals, stock and invoice sequences are checked by the server.
export interface Commands {
  'product.save': { input: Product; result: null };
  'product.delete': { input: { id: string }; result: null };
  'product.import': { input: { products: Product[] }; result: null };
  'stock.adjust': { input: { productId: string; change: number; reason: string }; result: null };
  'sale.create': { input: CheckoutInput; result: Sale };
  'supplier.create': { input: Supplier; result: null };
  'purchase.create': { input: Purchase; result: null };
  'purchase.receive': { input: { id: string }; result: null };
  'purchase.payment': { input: { id: string; paymentStatus: Purchase['paymentStatus'] }; result: null };
  'expense.create': { input: Expense; result: null };
  'staff.save': { input: Staff & { password?: string }; result: null };
  'settings.save': { input: Settings; result: null };
}
