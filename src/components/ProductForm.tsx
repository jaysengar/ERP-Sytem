import { ChevronDown } from 'lucide-react';
import { useStore } from '../data/Store';
import { categories } from '../domain/types';
import type { Category, Product } from '../domain/types';
import { saveProduct } from '../domain/transactions';
import { uid } from '../domain/format';
import { Dialog, Field, Form, numberValue, textValue } from './ui';

export function ProductForm({ product, onClose }: { product?: Product; onClose: () => void }) {
  const { db, role, mutate, toast } = useStore();
  return (
    <Dialog title={product ? 'Edit product' : 'Add a new product'} onClose={onClose} wide>
      <p className="product-form-intro">Create one size and colour combination at a time. <span>Fields marked <b aria-hidden="true">*</b><span className="sr-only">with an asterisk</span> are required.</span></p>
      <Form className="product-form" submitLabel={product ? 'Save product' : 'Add product'} onCancel={onClose} onSubmit={async data => {
        const next: Product = {
          id: product?.id || uid(), styleId: textValue(data, 'styleId') || product?.styleId || uid(),
          name: textValue(data, 'name'), sku: textValue(data, 'sku'), barcode: textValue(data, 'barcode'),
          category: textValue(data, 'category') as Category, brand: textValue(data, 'brand'),
          size: textValue(data, 'size'), colour: textValue(data, 'colour'),
          purchasePrice: numberValue(data, 'purchasePrice'), sellingPrice: numberValue(data, 'sellingPrice'),
          quantity: product?.quantity ?? numberValue(data, 'quantity'), minStock: numberValue(data, 'minStock'),
          image: textValue(data, 'image'),
        };
        await mutate(draft => saveProduct(draft, role, next));
        toast(product ? 'Product updated.' : 'Product added to your store.');
        onClose();
      }}>
        <fieldset className="form-section">
          <legend>Product details</legend>
          <p>Make the product easy to find at the counter.</p>
          <div className="form-grid">
            <Field label="Product name" className="span-2"><input name="name" defaultValue={product?.name} required maxLength={100} autoFocus placeholder="e.g. Oxford Cotton Shirt" /></Field>
            <Field label="Category"><select name="category" defaultValue={product?.category || categories[0]}>{categories.map(c => <option key={c}>{c}</option>)}</select></Field>
            <Field label="Brand"><input name="brand" defaultValue={product?.brand} required maxLength={60} placeholder="e.g. Urban Thread" /></Field>
            <Field label="SKU / product code"><input name="sku" defaultValue={product?.sku} required maxLength={40} autoComplete="off" spellCheck={false} placeholder="UT-019-01" /></Field>
            <Field label="Barcode"><input name="barcode" defaultValue={product?.barcode} required maxLength={40} autoComplete="off" spellCheck={false} placeholder="8901000000145" /></Field>
          </div>
        </fieldset>
        <fieldset className="form-section">
          <legend>Size & colour</legend>
          <p>Each combination has its own stock quantity.</p>
          <div className="form-grid">
            <Field label="Size"><input name="size" defaultValue={product?.size} required maxLength={20} placeholder="M, XL, 32 or Free size" /></Field>
            <Field label="Colour"><input name="colour" defaultValue={product?.colour} required maxLength={30} placeholder="Navy" /></Field>
          </div>
        </fieldset>
        <fieldset className="form-section">
          <legend>Pricing & stock</legend>
          <p>Enter prices in Indian Rupees (₹).</p>
          <div className="form-grid">
            <Field label="Purchase price (₹)"><input name="purchasePrice" type="number" min="0" max="10000000" step="0.01" inputMode="decimal" required defaultValue={product?.purchasePrice} /></Field>
            <Field label="Selling price (₹)"><input name="sellingPrice" type="number" min="0.01" max="10000000" step="0.01" inputMode="decimal" required defaultValue={product?.sellingPrice} /></Field>
            <Field label={product ? 'Current stock' : 'Opening quantity'} hint={product ? 'Use Adjust stock to record stock changes.' : 'Pieces available on your shelves now.'}><input name="quantity" type="number" min="0" max="1000000" step="1" inputMode="numeric" required readOnly={!!product} defaultValue={product?.quantity ?? 0} /></Field>
            <Field label="Minimum stock level" hint="Alert when stock reaches this quantity."><input name="minStock" type="number" min="0" max="1000000" step="1" inputMode="numeric" required defaultValue={product?.minStock ?? db.settings.lowStockThreshold} /></Field>
          </div>
        </fieldset>
        <details className="form-optional">
          <summary><span>Photo & variant grouping <small>Optional</small></span><ChevronDown size={18} aria-hidden="true" /></summary>
          <div className="form-grid">
            <Field label="Product image URL" className="span-2" hint="A category icon appears when no image is available."><input name="image" type="url" defaultValue={product?.image} placeholder="https://…" maxLength={2000} /></Field>
            <Field label="Style / variant group" className="span-2" hint="Use the same group for sizes and colours of one style. Leave blank to create a new group."><input name="styleId" defaultValue={product?.styleId} maxLength={60} /></Field>
          </div>
        </details>
      </Form>
    </Dialog>
  );
}
