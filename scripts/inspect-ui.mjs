import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const output = process.argv[2] || 'artifacts/ui-review';
const baseURL = process.env.RETAIL_PREVIEW_URL || 'http://127.0.0.1:5173';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const results = [];
try {
  for (const [name, route, width, height] of [
    ['dashboard-desktop', '/', 1440, 1000],
    ['products-desktop', '/products', 1440, 1000],
    ['pos-desktop', '/pos', 1440, 1000],
    ['dashboard-tablet', '/', 1024, 900],
    ['dashboard-mobile', '/', 375, 812],
    ['products-mobile', '/products', 375, 812],
    ['pos-mobile', '/pos', 375, 812],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto(baseURL + route);
    await page.waitForLoadState('networkidle');
    await page.locator('h1').waitFor();
    await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
    results.push(await page.evaluate(({ name, width }) => ({
      name,
      overflow: document.documentElement.scrollWidth > width,
      heading: document.querySelector('h1')?.textContent,
      smallText: [...document.querySelectorAll('button, p, small, th, td, input')]
        .filter(e => e.getBoundingClientRect().width > 0 && Number.parseFloat(getComputedStyle(e).fontSize) < 12)
        .slice(0, 15).map(e => ({ text: e.textContent?.trim().slice(0, 45), fontSize: getComputedStyle(e).fontSize })),
    }), { name, width }));
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(baseURL + '/products');
  await page.getByRole('button', { name: 'Add product', exact: true }).click();
  await page.screenshot({ path: `${output}/product-form-desktop.png` });
  await page.getByRole('dialog').getByRole('button', { name: 'Add product', exact: true }).click();
  await page.getByRole('alert').waitFor();
  await page.screenshot({ path: `${output}/product-validation-desktop.png` });
  await page.getByRole('button', { name: 'Close dialog' }).click();

  await page.goto(baseURL + '/products?category=Accessories&brand=Allen+Solly&sort=price-desc');
  await page.getByRole('button', { name: 'Remove category filter: Accessories' }).waitFor();
  await page.screenshot({ path: `${output}/product-filters-desktop.png` });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: `${output}/product-filters-mobile.png` });

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(baseURL + '/pos');
  await page.getByRole('textbox', { name: 'Scan or enter barcode' }).fill('8901000000002');
  await page.getByRole('button', { name: 'Add barcode product' }).click();
  await page.getByRole('button', { name: 'View bill', exact: true }).click();
  await page.locator('#current-bill').waitFor();
  await page.screenshot({ path: `${output}/pos-bill-mobile.png`, fullPage: true });
  await page.getByLabel('Mobile number', { exact: true }).fill('123');
  await page.getByRole('button', { name: 'Review bill' }).click();
  await page.getByText('Enter 10 digits starting with 6–9, or leave this blank.').waitFor();
  await page.screenshot({ path: `${output}/pos-phone-validation-mobile.png` });
  await page.getByLabel('Mobile number', { exact: true }).clear();
  await page.getByRole('button', { name: 'Review bill' }).click();
  await page.screenshot({ path: `${output}/pos-review-mobile.png` });
  await page.getByRole('button', { name: /Complete sale ·/ }).click();
  await page.getByRole('heading', { name: 'Sale completed', exact: true }).waitFor();
  await page.screenshot({ path: `${output}/invoice-mobile.png` });
  await page.pdf({ path: `${output}/invoice-print.pdf`, format: 'A4', printBackground: true });
  await writeFile(`${output}/review.json`, JSON.stringify({ results, errors }, null, 2));
  console.log(JSON.stringify({ results, errors }, null, 2));
} finally {
  await browser.close();
}
