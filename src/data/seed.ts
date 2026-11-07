import type { Database, Product, Sale, Category } from '../domain/types';
import { dateKey, round, sum } from '../domain/format';

const styles: [string, Category, string, number, number, string][] = [
  ['Oxford Cotton Shirt', 'Shirts', 'Arrow', 680, 1299, 'shirt'],
  ['Linen Blend Shirt', 'Shirts', 'Van Heusen', 890, 1799, 'shirt'],
  ['Everyday Crew Neck Tee', 'T-Shirts', 'Jockey', 290, 599, 'tee'],
  ['Classic Polo T-Shirt', 'T-Shirts', 'U.S. Polo Assn.', 540, 1099, 'tee'],
  ['Slim Fit Denim', 'Jeans', "Levi’s", 1120, 2299, 'jeans'],
  ['Straight Fit Jeans', 'Jeans', 'Pepe Jeans', 980, 1999, 'jeans'],
  ['Stretch Cotton Chinos', 'Trousers', 'Allen Solly', 740, 1499, 'trousers'],
  ['Tailored Formal Trousers', 'Trousers', 'Van Heusen', 950, 1899, 'trousers'],
  ['Floral Cotton Kurti', 'Kurtis', 'Aurelia', 590, 1199, 'kurti'],
  ['Embroidered A-Line Kurti', 'Kurtis', 'W for Woman', 850, 1699, 'kurti'],
  ['Chanderi Silk Saree', 'Sarees', 'Urban Weave', 1600, 3299, 'saree'],
  ['Handloom Cotton Saree', 'Sarees', 'Urban Weave', 1100, 2299, 'saree'],
  ['Festive Kurta Set', 'Suits', 'Manyavar', 2200, 4499, 'suit'],
  ['Classic Two-Piece Suit', 'Suits', 'Raymond', 4200, 8499, 'suit'],
  ['Kids Striped Cotton Tee', 'Kids Wear', 'FirstCry', 240, 499, 'tee'],
  ['Kids Denim Dungarees', 'Kids Wear', 'Gini & Jony', 620, 1299, 'jeans'],
  ['Braided Leather Belt', 'Accessories', 'Allen Solly', 350, 799, 'belt'],
  ['Soft Cotton Stole', 'Accessories', 'Urban Weave', 220, 499, 'stole'],
];
export function seedDatabase(now = new Date()): Database {
  const products: Product[] = styles.flatMap(([name, category, brand, cost, price], s) => Array.from({ length: 8 }, (_, v) => {
    const i = s * 8 + v; const oneSize = ['Sarees', 'Accessories'].includes(category);
    return { id: `p-${i + 1}`, styleId: `style-${s + 1}`, name, category, brand, purchasePrice: cost, sellingPrice: price,
      sku: `UT-${String(s + 1).padStart(3, '0')}-${String(v + 1).padStart(2, '0')}`, barcode: `8901000${String(i + 1).padStart(6, '0')}`,
      size: oneSize ? 'Free size' : category === 'Kids Wear' ? ['2–3Y', '4–5Y', '6–7Y', '8–9Y'][v % 4] : ['S', 'M', 'L', 'XL'][v % 4],
      colour: oneSize ? ['Ivory', 'Navy', 'Rose', 'Olive', 'Maroon', 'Beige', 'Black', 'Sky'][v] : (v < 4 ? ['Sky', 'Navy', 'Indigo', 'Beige', 'Rose', 'Olive'][s % 6] : ['White', 'Black', 'Blue', 'Sand', 'Maroon', 'Ivory'][s % 6]),
      quantity: i % 19 === 0 ? 0 : i % 9 === 0 ? (i % 5) + 1 : 18 + (i * 13) % 72, minStock: 8, image: '' };
  }));
  const settings = { shopName: 'Urban Thread', address: '24, Commercial Street, Bengaluru, Karnataka 560001', phone: '080 4123 5678', invoicePrefix: 'UT', invoiceFooter: 'Thank you for shopping with us. Please keep this invoice for exchanges.', gstEnabled: false, gstin: '', taxRate: 5, lowStockThreshold: 8, profileName: 'Arjun Mehta', profileEmail: 'arjun@example.com' };
  const customers = ['Priya Sharma', 'Rahul Verma', 'Ananya Rao', 'Vikram Singh', 'Neha Patel', 'Rohan Gupta', 'Meera Nair', 'Amit Kumar', 'Sneha Iyer', 'Karan Shah', 'Pooja Reddy', 'Aditya Jain', 'Ishita Das', 'Sanjay Joshi', 'Kavya Menon', 'Dev Malhotra', 'Nisha Kapoor', 'Varun Sethi'].map((name, i) => ({ id: `c-${i + 1}`, name, mobile: `98${String(12000000 + i * 917).padStart(8, '0')}` }));
  const suppliers = [
    { id: 'su-1', name: 'Metro Apparel Distributors', contact: 'Rajesh Shah', mobile: '9845012345', email: 'orders@example.com', address: 'Chickpet, Bengaluru' },
    { id: 'su-2', name: 'Southern Textile Co.', contact: 'Lakshmi Rao', mobile: '9845023456', email: 'sales@example.com', address: 'Tiruppur, Tamil Nadu' },
    { id: 'su-3', name: 'Heritage Ethnic Wear', contact: 'Asha Jain', mobile: '9845034567', email: 'hello@example.com', address: 'Surat, Gujarat' },
    { id: 'su-4', name: 'Little Steps Clothing', contact: 'Mohit Kumar', mobile: '9845045678', email: 'stock@example.com', address: 'Peenya, Bengaluru' },
  ];
  const sales: Sale[] = [];
  for (let day = 89; day >= 0; day--) {
    const orders = day === 0 ? 14 : 5 + (day * 7 % 11);
    for (let n = 0; n < orders; n++) {
      const date = new Date(now); date.setDate(date.getDate() - day); date.setHours(10 + n % 9, (n * 13) % 60, 0, 0);
      const customer = customers[(day + n) % customers.length];
      const lines = Array.from({ length: 1 + (n % 3) }, (_, k) => {
        const p = products[(day * 3 + n * 7 + k * 19) % products.length];
        return { productId: p.id, name: p.name, sku: p.sku, size: p.size, colour: p.colour, quantity: 1 + ((n + k) % 3 === 0 ? 1 : 0), price: p.sellingPrice, cost: p.purchasePrice };
      });
      const subtotal = sum(lines, l => l.quantity * l.price); const discount = n % 4 === 0 ? round(subtotal * 0.05) : 0;
      sales.push({ id: `sale-${sales.length + 1}`, invoice: `UT-${String(sales.length + 1).padStart(5, '0')}`, date: date.toISOString(), customerId: n % 5 === 0 ? undefined : customer.id, customerName: n % 5 === 0 ? 'Walk-in customer' : customer.name, mobile: n % 5 === 0 ? '' : customer.mobile, lines, subtotal, discount, tax: 0, taxRate: 0, total: round(subtotal - discount), paymentMethod: (['Cash', 'UPI', 'Card'] as const)[n % 3], paymentStatus: 'Paid', shop: { name: settings.shopName, address: settings.address, phone: settings.phone, gstin: '', footer: settings.invoiceFooter } });
    }
  }
  const purchases = Array.from({ length: 14 }, (_, i) => {
    const date = new Date(now); date.setDate(date.getDate() - i * 3);
    const lines = Array.from({ length: 3 }, (_, k) => { const p = products[(i * 11 + k * 8) % products.length]; return { productId: p.id, name: p.name, sku: p.sku, quantity: 12 + k * 6, cost: p.purchasePrice }; });
    return { id: `pur-${i + 1}`, reference: `PO-${String(1001 + i)}`, supplierId: suppliers[i % 4].id, date: dateKey(date), lines, total: sum(lines, l => l.quantity * l.cost), status: i < 2 ? 'Ordered' as const : 'Received' as const, receivedAt: i < 2 ? undefined : date.toISOString(), paymentStatus: i % 3 === 0 ? 'Unpaid' as const : 'Paid' as const };
  });
  const expenses = Array.from({ length: 25 }, (_, i) => { const d = new Date(now); d.setDate(d.getDate() - i); return { id: `ex-${i + 1}`, category: ['Utilities', 'Transport', 'Supplies', 'Maintenance', 'Other'][i % 5], amount: [850, 450, 1200, 650, 300][i % 5], date: dateKey(d), description: ['Electricity and water', 'Stock delivery charges', 'Shopping bags and packaging', 'Store cleaning supplies', 'Tea and refreshments'][i % 5] }; });
  return { version: 1, revision: 0, products, customers, suppliers, sales, purchases, expenses, settings, movements: [], staff: [
    { id: 'st-1', name: 'Arjun Mehta', email: 'arjun@example.com', role: 'Owner / Admin', active: true },
    { id: 'st-2', name: 'Priya Desai', email: 'priya@example.com', role: 'Cashier', active: true },
    { id: 'st-3', name: 'Ravi Kumar', email: 'ravi@example.com', role: 'Inventory Manager', active: true },
  ] };
}
