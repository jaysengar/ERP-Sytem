import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const output = [];
for (const route of ['/', '/products', '/inventory', '/pos', '/purchases', '/sales', '/customers', '/expenses', '/reports', '/staff', '/settings']) {
  await page.goto((process.env.RETAIL_PREVIEW_URL || 'http://127.0.0.1:5173') + route);
  await page.locator('h1').waitFor();
  const failures = await page.evaluate(() => {
    const rgb = color => { const values = color.match(/[\d.]+/g)?.map(Number); return values?.length >= 3 ? values : null; };
    const luminance = values => values.slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((n, v, i) => n + v * [.2126, .7152, .0722][i], 0);
    const entries = new Map();
    for (const element of document.querySelectorAll('p, small, span, strong, label, button, th, td, a')) {
      if (!element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) || element.closest('[inert], [disabled]')) continue;
      if (![...element.childNodes].some(node => node.nodeType === 3 && node.textContent.trim())) continue;
      const style = getComputedStyle(element); const foreground = rgb(style.color); if (!foreground) continue;
      let current = element; let background = [255, 255, 255];
      while (current) { const color = rgb(getComputedStyle(current).backgroundColor); if (color && (color.length === 3 || color[3] === 1)) { background = color; break; } current = current.parentElement; }
      const ratio = (Math.max(luminance(foreground), luminance(background)) + .05) / (Math.min(luminance(foreground), luminance(background)) + .05);
      const fontSize = parseFloat(style.fontSize); const target = fontSize >= 24 || (fontSize >= 18.66 && Number(style.fontWeight) >= 700) ? 3 : 4.5;
      if (ratio < target) { const key = `${style.color} on ${background.join(',')}`; if (!entries.has(key)) entries.set(key, { text: element.textContent.trim().slice(0, 65), selector: element.className, ratio: Number(ratio.toFixed(2)), color: style.color, background }); }
    }
    return [...entries.values()];
  });
  output.push({ route, failures });
}
console.log(JSON.stringify(output, null, 2));
await browser.close();
