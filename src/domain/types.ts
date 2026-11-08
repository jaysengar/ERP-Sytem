export const categories = ['Shirts', 'T-Shirts', 'Jeans', 'Trousers', 'Kurtis', 'Sarees', 'Suits', 'Kids Wear', 'Accessories'] as const;
export type Category = typeof categories[number];
export type Role = 'Owner / Admin' | 'Cashier' | 'Inventory Manager';
export type PaymentMethod = 'Cash' | 'UPI' | 'Card' | 'Other';
export interface Product {
  id: string; styleId: string; name: string; sku: string; barcode: string;
  category: Category; brand: string; size: string; colour: string;
  purchasePrice: number; sellingPrice: number; quantity: number; minStock: number; image: string;
}
export interface Customer { id: string; name: string; mobile: string }
export interface Supplier { id: string; name: string; contact: string; mobile: string; email: string; address: string }
export interface SaleLine { productId: string; name: string; sku: string; size: string; colour: string; quantity: number; price: number; cost: number | null }
export interface InvoiceShop { name: string; address: string; phone: string; gstin: string; footer: string }
export interface Sale {
  sample?: boolean;
  id: string; invoice: string; date: string; customerId?: string; customerName: string; mobile: string;
  lines: SaleLine[]; subtotal: number; discount: number; taxRate: number; tax: number; total: number;
  paymentMethod: PaymentMethod; paymentStatus: 'Paid'; shop: InvoiceShop;
}
export interface PurchaseLine { productId: string; name: string; sku: string; quantity: number; cost: number }
export interface Purchase {
  id: string; reference: string; supplierId: string; date: string; lines: PurchaseLine[];
  total: number; status: 'Ordered' | 'Received'; paymentStatus: 'Paid' | 'Unpaid' | 'Partial'; receivedAt?: string;
}
export interface Expense { id: string; category: string; amount: number; date: string; description: string }
export interface Staff { id: string; name: string; email: string; role: Role; active: boolean }
export interface Settings {
  shopName: string; address: string; phone: string; invoicePrefix: string; invoiceFooter: string;
  gstEnabled: boolean; gstin: string; taxRate: number; lowStockThreshold: number; profileName: string; profileEmail: string;
}
export interface StockMovement { id: string; productId: string; date: string; change: number; reason: string; reference: string }
export interface Database {
  version: 1; revision: number; products: Product[]; customers: Customer[]; suppliers: Supplier[];
  sales: Sale[]; purchases: Purchase[]; expenses: Expense[]; staff: Staff[]; settings: Settings; movements: StockMovement[];
}
export interface ProductQuery { search?: string; category?: string; brand?: string; stock?: string; sort?: string; page?: number; pageSize?: number }
export interface Page<T> { items: T[]; total: number; page: number; pageSize: number }
export interface CheckoutInput { lines: { productId: string; quantity: number }[]; discount: number; customerName: string; mobile: string; paymentMethod: PaymentMethod }
export type Permission = 'sell' | 'products' | 'delete' | 'purchase' | 'expenses' | 'reports' | 'staff' | 'settings';
export const permissions: Record<Role, Permission[]> = {
  'Owner / Admin': ['sell', 'products', 'delete', 'purchase', 'expenses', 'reports', 'staff', 'settings'],
  Cashier: ['sell'],
  'Inventory Manager': ['products', 'purchase'],
};
export const can = (role: Role, action: Permission) => permissions[role].includes(action);
