import { test as guestTest, expect } from '@playwright/test';
import { test } from './fixtures';
import { mkdir } from 'node:fs/promises';

guestTest('business registration, login and billing work on desktop and mobile', async ({ page }) => {
  const slug = `signup-${crypto.randomUUID().slice(0, 8)}`;
  await page.route('https://checkout.retail-test.invalid/**', async route => {
    const id = new URL(route.request().url()).pathname.slice(1);
    await route.fulfill({ contentType: 'text/html', body: `<h1>Razorpay test checkout</h1><p>Pay INR 1,500 for the first month.</p><form method="post" action="http://127.0.0.1:5191/__test/pay/${id}"><button>Authorize monthly payment</button></form>` });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await page.getByRole('button', { name: 'New business? Get started' }).click();
  await expect(page.getByText('Your own workspace, inventory and team.', { exact: false })).toBeVisible();
  await page.getByLabel('Business name', { exact: true }).fill('Thread House');
  await page.getByLabel('Workspace ID', { exact: true }).fill(slug);
  await page.getByLabel('Your name', { exact: true }).fill('Shop Owner');
  await page.getByLabel('Email address', { exact: true }).fill(`${slug}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('A strong testing password!');
  await page.getByLabel('Confirm password', { exact: true }).fill('A strong testing password!');
  await page.getByRole('checkbox', { name: /I agree to pay ₹1,500 now/ }).check();
  await mkdir('artifacts/backend', { recursive: true });
  await page.screenshot({ path: 'artifacts/backend/registration-desktop.png', fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 375, height: 812 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/backend/registration-mobile.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Continue to payment · ₹1,500', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Razorpay test checkout' })).toBeVisible();
  const unpaid = await page.context().request.get(`http://127.0.0.1:5191/api/w/${slug}/billing`);
  expect((await unpaid.json()).canWrite).toBe(false);
  await page.getByRole('button', { name: 'Authorize monthly payment' }).click();
  await expect(page.getByRole('heading', { name: 'Billing & subscription', exact: true })).toBeVisible();
  await expect(page.getByText('Paid access', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel & request ₹1,500 refund' })).toBeEnabled();
  await page.screenshot({ path: 'artifacts/backend/billing-mobile.png', fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'artifacts/backend/billing-desktop.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Open profile menu' }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await page.getByLabel('Email address', { exact: true }).fill(`${slug}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('wrong');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Email or password is incorrect');
  await page.getByLabel('Password', { exact: true }).fill('A strong testing password!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Billing & subscription', exact: true })).toBeVisible();
});

test('an owner can cancel in the guarantee window and see the confirmed refund', async ({ page }) => {
  await page.goto('/billing');
  await expect(page.getByText('Paid access', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel & request ₹1,500 refund', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('editing access end immediately');
  await expect(page.getByRole('dialog')).toContainText('full ₹1,500 refund');
  await page.getByRole('button', { name: 'Cancel & request refund', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Access cancelled', { exact: true })).toBeVisible();
  await expect(page.getByText('Razorpay has processed your refund.', { exact: false }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByText('Access cancelled', { exact: true })).toBeVisible();
  await expect(page.getByText('Refund reference:', { exact: false })).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mkdir('artifacts/backend', { recursive: true });
  await page.screenshot({ path: 'artifacts/backend/refund-mobile.png', fullPage: true, animations: 'disabled' });

  await page.route('https://checkout.retail-test.invalid/**', async route => {
    const id = new URL(route.request().url()).pathname.slice(1);
    await route.fulfill({ contentType: 'text/html', body: `<h1>Razorpay test checkout</h1><form method="post" action="http://127.0.0.1:5191/__test/pay/${id}"><button>Authorize monthly payment</button></form>` });
  });
  await page.getByRole('button', { name: 'Pay ₹1,500 & activate', exact: true }).click();
  await page.getByRole('button', { name: 'Authorize monthly payment', exact: true }).click();
  await expect(page.getByText('Paid access', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel & request ₹1,500 refund', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancel renewal', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('does not include a refund');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel renewal', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Renewal cancellation is scheduled for the end', { exact: false })).toBeVisible();
  await expect(page.getByText('Paid access', { exact: true })).toBeVisible();
});

test('interrupted checkout can be retried without duplicating an invoice', async ({ page }) => {
  await page.goto('/pos');
  await page.getByRole('textbox', { name: 'Scan or enter barcode' }).fill('8901000000002');
  await page.getByRole('button', { name: 'Add barcode product' }).click();
  await page.getByRole('button', { name: 'Review bill' }).click();
  const before = await page.evaluate(async () => (await (await fetch(`/api/w/${localStorage.getItem('retail-workspace')}/state`)).json()).data.sales.length);
  let aborted = false;
  await page.route('**/commands', async route => {
    if (!aborted) { aborted = true; await route.fetch(); await route.abort('failed'); }
    else await route.continue();
  });
  await page.getByRole('button', { name: /Complete sale ·/ }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('server could not be reached');
  await page.getByRole('button', { name: /Complete sale ·/ }).click();
  await expect(page.getByRole('heading', { name: 'Sale completed', exact: true })).toBeVisible();
  const after = await page.evaluate(async () => (await (await fetch(`/api/w/${localStorage.getItem('retail-workspace')}/state`)).json()).data.sales.length);
  expect(after).toBe(before + 1);
});

test('an open tab does not switch workspaces when another tab changes the remembered ID', async ({ page }) => {
  await page.goto('/products');
  await expect(page.getByRole('heading', { name: 'Products', exact: true })).toBeVisible();
  await page.evaluate(() => localStorage.setItem('retail-workspace', 'another-business'));
  await page.getByRole('textbox', { name: 'Search name, SKU or barcode…' }).fill('8901000000002');
  await expect(page.getByText('UT-001-02', { exact: true })).toBeVisible();
});
