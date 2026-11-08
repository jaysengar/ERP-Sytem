import { createHmac, timingSafeEqual } from 'node:crypto';
import { ApiError } from './security.mjs';

export const PLAN = { amount: 150000, currency: 'INR', interval: 1, period: 'monthly', trialDays: 7, policy: 'upfront_refund_v1' };
export function razorpayClient({ keyId, keySecret, planId, webhookSecret, fetcher = fetch } = {}) {
  const configured = Boolean(keyId && keySecret && planId && webhookSecret);
  async function api(path, payload) {
    if (!configured) throw new ApiError(503, 'Subscriptions are being set up. Please contact support.');
    let response;
    try { response = await fetcher(`https://api.razorpay.com/v1${path}`, { method: payload === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(15000), headers: { Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`, 'Content-Type': 'application/json' }, body: payload === undefined ? undefined : JSON.stringify(payload) }); }
    catch { throw new ApiError(502, 'Razorpay could not be reached. Please try again shortly.'); }
    const result = await response.json();
    if (!response.ok) {
      const error = new ApiError(502, 'Razorpay could not complete the request. Please try again or contact support.');
      error.providerRejected = response.status >= 400 && response.status < 500;
      throw error;
    }
    return result;
  }
  async function collection(path) {
    const items = [];
    for (let skip = 0; skip < 1000; skip += 100) {
      const result = await api(`${path}${path.includes('?') ? '&' : '?'}count=100&skip=${skip}`);
      if (!Array.isArray(result.items)) throw new ApiError(502, 'Razorpay returned an incomplete payment history. Please try again.');
      items.push(...result.items);
      if (result.items.length < 100) return items;
    }
    throw new ApiError(502, 'This payment history needs support review.');
  }
  return {
    configured, planId,
    async create(workspace) {
      const plan = await api(`/plans/${encodeURIComponent(planId)}`);
      if (plan.period !== PLAN.period || plan.interval !== PLAN.interval || plan.item?.amount !== PLAN.amount || plan.item?.currency !== PLAN.currency) throw new ApiError(503, 'The subscription plan is not available. Please contact support.');
      return api('/subscriptions', { plan_id: planId, total_count: 120, quantity: 1, customer_notify: 1,
        // No future start_at: the first monthly payment is collected when the
        // customer authorizes checkout. The seven days are a refund window.
        notes: { workspaceId: workspace.id },
      });
    },
    get: id => api(`/subscriptions/${encodeURIComponent(id)}`),
    cancel: (id, atCycleEnd = true) => api(`/subscriptions/${encodeURIComponent(id)}/cancel`, { cancel_at_cycle_end: atCycleEnd ? 1 : 0 }),
    invoices: id => collection(`/invoices?subscription_id=${encodeURIComponent(id)}`),
    payment: id => api(`/payments/${encodeURIComponent(id)}`),
    refunds: id => collection(`/payments/${encodeURIComponent(id)}/refunds`),
    refund: (id, amount, receipt, workspaceId) => api(`/payments/${encodeURIComponent(id)}/refund`, { amount, speed: 'normal', receipt, notes: { workspaceId, refundRequestId: workspaceId, reason: 'Cancelled within the first seven days' } }),
    verify(raw, signature) {
      if (!webhookSecret || typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) return false;
      const expected = createHmac('sha256', webhookSecret).update(raw).digest();
      return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
    },
  };
}
export function billingView(workspace, configured, now = Date.now()) {
  const legacyTrial = workspace.billing_policy !== PLAN.policy && workspace.trial_end > now;
  const refundApplies = workspace.refund_subscription_id === workspace.subscription_id && Boolean(workspace.refund_status);
  const refundEligible = workspace.billing_policy === PLAN.policy && workspace.first_subscription_id === workspace.subscription_id
    && Boolean(workspace.first_payment_id) && now <= workspace.refund_deadline && !workspace.refund_status;
  return { name: workspace.name, slug: workspace.slug, amount: PLAN.amount, currency: PLAN.currency,
    policy: workspace.billing_policy, legacyTrial, trialEndsAt: new Date(workspace.trial_end).toISOString(),
    paidUntil: !refundApplies && workspace.paid_until ? new Date(workspace.paid_until).toISOString() : null,
    status: workspace.subscription_status || 'payment_required', canWrite: !refundApplies && (legacyTrial || workspace.paid_until > now),
    configured, hasSubscription: Boolean(workspace.subscription_id), checkoutUrl: workspace.checkout_url || null, cancelPending: Boolean(workspace.cancel_pending),
    refundEligible, refundDeadline: workspace.refund_deadline ? new Date(workspace.refund_deadline).toISOString() : null,
    refundForCurrentSubscription: refundApplies,
    refundStatus: workspace.refund_status || null, refundId: workspace.provider_refund_id || null,
    refundAmount: workspace.refund_status ? PLAN.amount : 0,
  };
}
