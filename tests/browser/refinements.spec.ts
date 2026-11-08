import { test, expect } from './fixtures';

test('invalid product fields have visible errors and preserve entered values', async ({ page }) => {
  await page.goto('/products');
  await page.getByRole('button', { name: 'Add product', exact: true }).click();
  await page.getByLabel('Product name', { exact: true }).fill('Unfinished sample');
  await page.getByRole('dialog').getByRole('button', { name: 'Add product', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Check the highlighted fields');
  await expect(page.getByLabel('SKU / product code')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('Product name', { exact: true })).toHaveValue('Unfinished sample');
  await page.getByRole('alert').getByRole('button', { name: 'SKU / product code' }).click();
  await expect(page.getByLabel('SKU / product code')).toBeFocused();
  await page.getByLabel('SKU / product code').fill('RECOVER-001');
  await expect(page.getByLabel('SKU / product code')).not.toHaveAttribute('aria-invalid', 'true');
  await page.mouse.click(2, 2);
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole('alert').getByRole('button', { name: 'Barcode', exact: true }).click();
  await expect(page.getByLabel('Barcode', { exact: true })).toBeFocused();
  expect(await page.getByLabel('Barcode', { exact: true }).evaluate(input => {
    const bounds = input.getBoundingClientRect();
    const header = document.querySelector('.modal-heading')!.getBoundingClientRect();
    const footer = document.querySelector('.modal .form-footer')!.getBoundingClientRect();
    return bounds.top >= header.bottom && bounds.bottom <= footer.top;
  })).toBe(true);
});

test('mobile menu traps focus, restores it and hides closed links from the keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await expect(page.locator('#store-navigation')).toHaveAttribute('inert', '');
  await page.getByRole('link', { name: 'Skip to content' }).focus();
  await expect(page.getByRole('link', { name: 'Skip to content' })).toHaveCSS('opacity', '1');
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
  await page.getByRole('button', { name: 'Open navigation' }).click();
  const navigation = page.getByRole('dialog', { name: 'Main navigation' });
  await expect(navigation).toBeVisible();
  await navigation.getByRole('button', { name: 'Take a quick tour' }).focus();
  await page.keyboard.press('Tab');
  await expect(navigation.getByRole('link', { name: /smartretail/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Open navigation' })).toBeFocused();
  await expect(page.locator('#store-navigation')).toHaveAttribute('inert', '');
});

test('mobile POS lets the user switch to the bill and complete a sale', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/pos');
  await page.getByRole('textbox', { name: 'Scan or enter barcode' }).fill('8901000000002');
  await page.getByRole('button', { name: 'Add barcode product' }).click();
  await page.getByRole('button', { name: 'View bill', exact: true }).click();
  await expect(page.locator('#current-bill')).toBeVisible();
  await expect(page.locator('#pos-catalog')).toBeHidden();
  await expect(page.locator('.pos-mobile-tabs').getByRole('button', { name: /Current bill/ })).toBeFocused();
  await expect(page.getByRole('link', { name: 'Skip to content' })).toHaveCSS('opacity', '0');
  await page.getByRole('button', { name: 'Increase UT-001-02' }).click();
  await page.getByLabel('Discount (₹)').fill('999999');
  await expect(page.getByText('Discount cannot exceed the subtotal.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review bill' })).toBeDisabled();
  await page.getByLabel('Discount (₹)').fill('100');
  await page.getByRole('button', { name: 'Review bill' }).click();
  await page.getByRole('button', { name: /Complete sale ·/ }).click();
  await expect(page.getByRole('heading', { name: 'Sale completed' })).toBeVisible();
  const printButton = page.getByRole('button', { name: 'Print invoice' });
  await expect(printButton).toBeInViewport({ ratio: 1 });
  expect(await printButton.evaluate(button => {
    const bounds = button.getBoundingClientRect();
    const dialog = button.closest('dialog')!.getBoundingClientRect();
    return bounds.bottom <= dialog.bottom && bounds.top >= dialog.top;
  })).toBe(true);
});

test('rapidly clearing a filter and typing does not revive the old filter', async ({ page }) => {
  await page.goto('/products?category=Jeans');
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search name, SKU or barcode…' }).fill('Oxford');
  await expect(page.getByRole('combobox', { name: 'Filter by category' })).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Oxford Cotton Shirt', exact: true }).first()).toBeVisible();
  await expect(page).not.toHaveURL(/category=Jeans/);
});

test('profile opens a menu and the header shows the current page', async ({ page }) => {
  await page.goto('/expenses');
  await expect(page.locator('.store-breadcrumb strong')).toHaveText('Expenses');
  await page.getByRole('button', { name: 'Open profile menu' }).click();
  await page.getByRole('button', { name: 'Staff & permissions' }).click();
  await expect(page.getByRole('heading', { name: 'Staff & access', exact: true })).toBeVisible();
});

test('all pages fit mobile and input text does not trigger focus zoom', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const route of ['/', '/products', '/inventory', '/pos', '/purchases', '/sales', '/customers', '/expenses', '/reports', '/staff', '/settings']) {
    await page.goto(route);
    await page.locator('h1').waitFor();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await expect(page.getByLabel('Shop name')).toHaveCSS('font-size', '16px');
});
