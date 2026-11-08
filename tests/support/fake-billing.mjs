import { randomUUID } from 'node:crypto';
import { PLAN, razorpayClient } from '../../server/billing.mjs';

export const webhookSecret = 'isolated-test-webhook-secret';
export function fakeBilling({ now = Date.now, autoCapture = true } = {}) {
  const subscriptions = new Map(), invoices = new Map(), payments = new Map(), refunds = new Map();
  const calls = { create: [], cancel: [], refund: [] };
  const copy = value => structuredClone(value);
  const id = prefix => `${prefix}_${randomUUID().replaceAll('-', '')}`;
  function capture(subscriptionId, paidAt = now()) {
    const subscription = subscriptions.get(subscriptionId);
    const paymentId = id('pay'), orderId = id('order');
    const seconds = Math.floor(paidAt / 1000);
    const payment = { id: paymentId, order_id: orderId, status: 'captured', captured: true, amount: PLAN.amount, currency: PLAN.currency, amount_refunded: 0, created_at: seconds };
    payments.set(paymentId, payment); refunds.set(paymentId, []);
    invoices.get(subscriptionId).push({ id: id('inv'), subscription_id: subscriptionId, payment_id: paymentId, order_id: orderId, status: 'paid', paid_at: seconds, amount_paid: PLAN.amount, currency: PLAN.currency });
    Object.assign(subscription, { status: 'active', paid_count: subscription.paid_count + 1, current_start: seconds, current_end: seconds + 30 * 86400 });
    return payment;
  }
  return {
    configured: true, planId: 'plan_test', calls, subscriptions, invoiceRecords: invoices, paymentRecords: payments, refundRecords: refunds, capture,
    verify: razorpayClient({ webhookSecret }).verify,
    async create(workspace) {
      calls.create.push(workspace.id);
      const subscription = { id: id('sub'), status: 'created', plan_id: 'plan_test', notes: { workspaceId: workspace.id }, paid_count: 0, current_start: null, current_end: null };
      subscription.short_url = `https://checkout.retail-test.invalid/${subscription.id}`;
      subscriptions.set(subscription.id, subscription); invoices.set(subscription.id, []);
      if (autoCapture) capture(subscription.id);
      return copy(subscription);
    },
    async get(subscriptionId) { return copy(subscriptions.get(subscriptionId)); },
    async invoices(subscriptionId) { return copy(invoices.get(subscriptionId) || []); },
    async payment(paymentId) { return copy(payments.get(paymentId)); },
    async refunds(paymentId) { return copy(refunds.get(paymentId) || []); },
    async cancel(subscriptionId, atCycleEnd) {
      calls.cancel.push({ subscriptionId, atCycleEnd });
      if (!atCycleEnd) subscriptions.get(subscriptionId).status = 'cancelled';
      return copy(subscriptions.get(subscriptionId));
    },
    async refund(paymentId, amount, receipt, workspaceId) {
      calls.refund.push({ paymentId, amount, receipt, workspaceId });
      const payment = payments.get(paymentId);
      if (payment.amount_refunded + amount > payment.amount) throw new Error('Duplicate refund attempted.');
      const refund = { id: id('rfnd'), payment_id: paymentId, amount, currency: PLAN.currency, receipt, notes: { workspaceId, refundRequestId: workspaceId }, status: 'processed' };
      refunds.get(paymentId).push(refund); payment.amount_refunded += amount;
      if (payment.amount_refunded === payment.amount) payment.status = 'refunded';
      return copy(refund);
    },
  };
}
