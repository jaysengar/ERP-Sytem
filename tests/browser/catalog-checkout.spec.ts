import { test, expect } from './fixtures';
test.use({ hasTouch: true });

test('removing one filter preserves the other selection and sort order', async ({ page }) => {
  await page.goto('/products?category=Accessories&brand=Allen+Solly&sort=price-desc');
  await page.getByRole('button', { name: 'Remove category filter: Accessories' }).click();
  await expect(page.getByRole('combobox', { name: 'Filter by category' })).toHaveValue('');
  await expect(page.getByRole('combobox', { name: 'Filter by category' })).toBeFocused();
  await expect(page.getByRole('combobox', { name: 'Filter by brand' })).toHaveValue('Allen Solly');
  await expect(page.getByRole('combobox', { name: 'Sort products' })).toHaveValue('price-desc');
  await expect(page.getByRole('columnheader', { name: 'Selling price' })).toHaveAttribute('aria-sort', 'descending');
  await page.getByRole('button', { name: 'Selling price', exact: true }).click();
  await expect(page.getByRole('columnheader', { name: 'Selling price' })).toHaveAttribute('aria-sort', 'ascending');
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Search name, SKU or barcode…' })).toBeFocused();
  await expect(page.getByRole('combobox', { name: 'Filter by brand' })).toHaveValue('');
});

test('error summary opens an invalid optional field without losing form values', async ({ page }) => {
  await page.goto('/products');
  await page.getByRole('button', { name: 'Add product', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Product name', { exact: true }).fill('Summer Linen Shirt');
  const optional = dialog.locator('.form-optional');
  await optional.locator('summary').click();
  await dialog.getByLabel('Product image URL', { exact: true }).fill('not-a-valid-url');
  await optional.locator('summary').click();
  await dialog.getByRole('button', { name: 'Add product', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeFocused();
  expect(await dialog.locator('form').evaluate(form => form.firstElementChild?.getAttribute('role'))).toBe('alert');
  await dialog.getByRole('alert').getByRole('button', { name: 'Product image URL', exact: true }).click();
  await expect(optional).toHaveAttribute('open', '');
  await expect(dialog.getByLabel('Product image URL', { exact: true })).toBeFocused();
  await expect(dialog.getByLabel('Product name', { exact: true })).toHaveValue('Summer Linen Shirt');
});

test('checkout announces cart changes and guides recovery from an invalid mobile number', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/pos');
  await page.getByRole('textbox', { name: 'Scan or enter barcode' }).fill('8901000000002');
  await page.getByRole('button', { name: 'Add barcode product' }).click();
  await expect(page.locator('.checkout-feedback [role="status"]')).toHaveText('Oxford Cotton Shirt, M / Sky added. 1 piece in bill.');
  await page.getByRole('button', { name: 'View bill', exact: true }).click();
  await page.getByRole('button', { name: 'Increase UT-001-02' }).click();
  await expect(page.locator('.checkout-feedback [role="status"]')).toHaveText('Quantity updated. 2 pieces in bill.');
  await page.getByLabel('Mobile number', { exact: true }).fill('123');
  await page.getByRole('button', { name: 'Review bill' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('Mobile number', { exact: true })).toBeFocused();
  await expect(page.getByLabel('Mobile number', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Enter 10 digits starting with 6–9, or leave this blank.')).toBeVisible();
  await page.getByLabel('Mobile number', { exact: true }).clear();
  await page.getByRole('button', { name: 'UPI', exact: true }).click();
  await expect(page.getByRole('button', { name: 'UPI', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Review bill' }).click();
  await expect(page.getByRole('heading', { name: 'Review & complete sale' })).toBeVisible();
  await expect(page.getByRole('dialog').getByText('M · Sky × 2')).toBeVisible();
});

test('catalogue and checkout remain usable at narrow and landscape sizes', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  try {
    for (const viewport of [{ width: 320, height: 740 }, { width: 812, height: 375 }]) {
      await page.setViewportSize(viewport);
      for (const route of ['/products', '/pos']) {
        await page.goto(route);
        await page.locator('h1').waitFor();
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
      await page.goto('/products');
      const product = page.getByRole('button', { name: 'Braided Leather Belt', exact: true }).first();
      await expect(product).toBeVisible();
      expect((await product.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await page.getByRole('button', { name: 'Add product', exact: true }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.getByRole('button', { name: 'Close dialog' }).click();
    }
  } finally { /* The fixture closes this page. */ }
});
