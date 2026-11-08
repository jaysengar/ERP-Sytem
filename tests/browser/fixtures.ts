import { test as base, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
export const test = base.extend({
  context: async ({ context }, use) => {
    const slug = `test-${crypto.randomUUID().slice(0, 12)}`;
    const result = await context.request.post('/api/public/register', { headers: { 'X-Retail-Request': '1' }, data: {
      slug, shopName: 'Browser Test Store', name: 'Test Owner', email: `${slug}@example.test`, password: 'Browser test password 123!', sampleData: true, acceptTerms: true, billingPolicy: 'upfront_refund_v1',
    } });
    expect(result.status(), await result.text()).toBe(201);
    const registration = await result.json();
    const subscriptionId = new URL(registration.checkoutUrl).pathname.slice(1);
    expect((await context.request.post(`/__test/pay/${subscriptionId}`)).ok()).toBe(true);
    await context.addInitScript(value => { localStorage.setItem('retail-workspace', value); }, slug);
    await use(context);
  },
});
export { expect };
export async function state(page: Page) {
  return page.evaluate(async () => (await (await fetch(`/api/w/${localStorage.getItem('retail-workspace')}/state`)).json()).data);
}
