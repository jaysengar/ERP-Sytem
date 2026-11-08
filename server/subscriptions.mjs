import { randomUUID } from 'node:crypto';
import { ApiError } from './security.mjs';
import { billingView, PLAN } from './billing.mjs';

const terminal = status => ['cancelled', 'completed', 'expired'].includes(status);
const timestamp = value => Number.isSafeInteger(value) && value > 0 ? value * 1000 : 0;

export async function subscriptionManager(registry, billing, { now = Date.now } = {}) {
  if (registry.dialect === 'sqlite') {
  const columns = new Set((await registry.prepare('PRAGMA table_info(workspaces)').all()).map(column => column.name));
  for (const [name, definition] of Object.entries({
    cancel_pending: 'INTEGER NOT NULL DEFAULT 0', billing_policy: "TEXT NOT NULL DEFAULT 'legacy_trial'",
    first_payment_id: 'TEXT', first_subscription_id: 'TEXT', first_paid_at: 'INTEGER', refund_deadline: 'INTEGER',
  })) if (!columns.has(name)) await registry.exec(`ALTER TABLE workspaces ADD COLUMN ${name} ${definition}`);
  await registry.exec(`
    CREATE TABLE IF NOT EXISTS cancellation_requests (
      workspace_id TEXT NOT NULL, subscription_id TEXT NOT NULL, requested_at INTEGER NOT NULL,
      kind TEXT, completed INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(workspace_id, subscription_id)
    );
    CREATE TABLE IF NOT EXISTS refund_requests (
      workspace_id TEXT PRIMARY KEY, subscription_id TEXT NOT NULL, payment_id TEXT NOT NULL,
      requested_at INTEGER NOT NULL, status TEXT NOT NULL, receipt TEXT NOT NULL,
      provider_refund_id TEXT, attempted_amount INTEGER, updated_at INTEGER NOT NULL
    );
  `);
  }
  async function load(id) {
    return (await registry.prepare(`SELECT w.*, r.subscription_id AS refund_subscription_id, r.status AS refund_status,
      r.provider_refund_id FROM workspaces w LEFT JOIN refund_requests r ON r.workspace_id=w.id WHERE w.id=?`).get(id));
  }
  const view = async id => billingView((await load(id)), billing.configured, now());
  function validateSubscription(workspace, subscription) {
    if (subscription.id !== workspace.subscription_id || subscription.plan_id !== billing.planId || subscription.notes?.workspaceId !== workspace.id) throw new ApiError(400, 'Subscription does not match this workspace.');
  }
  async function saveSubscription(workspace, subscription) {
    validateSubscription(workspace, subscription);
    (await registry.prepare('UPDATE workspaces SET subscription_status=?,checkout_url=?,cancel_pending=? WHERE id=?').run(
      subscription.status, ['created', 'authenticated'].includes(subscription.status) ? subscription.short_url || workspace.checkout_url : null,
      terminal(subscription.status) ? 0 : workspace.cancel_pending, workspace.id,
    ));
  }
  async function sync(id) {
    let workspace = (await load(id));
    if (!workspace.subscription_id) return workspace;
    const subscription = await billing.get(workspace.subscription_id);
    (await saveSubscription(workspace, subscription));
    // Subscription activation/authorization alone is not proof of payment.
    // Verify invoices and captured payments belonging to this subscription.
    const invoices = (await billing.invoices(subscription.id))
      .filter(invoice => invoice.subscription_id === subscription.id && invoice.status === 'paid' && invoice.amount_paid === PLAN.amount && invoice.currency === PLAN.currency && invoice.payment_id)
      .sort((a, b) => a.paid_at - b.paid_at);
    const candidates = [...new Map([invoices[0], invoices.at(-1)].filter(Boolean).map(invoice => [invoice.payment_id, invoice])).values()];
    const verified = [];
    for (const invoice of candidates) {
      const payment = await billing.payment(invoice.payment_id);
      if (payment.id !== invoice.payment_id || payment.amount !== PLAN.amount || payment.currency !== PLAN.currency
        || !['captured', 'refunded'].includes(payment.status) || !invoice.order_id || payment.order_id !== invoice.order_id) continue;
      const paidAt = timestamp(invoice.paid_at);
      if (paidAt) verified.push({ payment, paidAt });
    }
    if (!workspace.first_payment_id && verified.length && workspace.billing_policy === PLAN.policy) {
      const first = verified[0];
      (await registry.prepare('UPDATE workspaces SET first_payment_id=?,first_subscription_id=?,first_paid_at=?,refund_deadline=? WHERE id=? AND first_payment_id IS NULL')
        .run(first.payment.id, subscription.id, first.paidAt, first.paidAt + PLAN.trialDays * 86400000, id));
    }
    const latest = verified.at(-1);
    const currentStart = timestamp(subscription.current_start), currentEnd = timestamp(subscription.current_end);
    if (latest && currentStart && currentEnd > currentStart && latest.paidAt >= currentStart) {
      if (latest.payment.status === 'captured' && latest.payment.amount_refunded === 0) {
        (await registry.prepare('UPDATE workspaces SET paid_until=max(paid_until,?) WHERE id=?').run(currentEnd, id));
      } else if (latest.payment.amount_refunded >= PLAN.amount) {
        (await registry.prepare('UPDATE workspaces SET paid_until=0 WHERE id=?').run(id));
      }
    }
    return (await load(id));
  }
  async function subscribe(id) {
    let workspace = (await load(id));
    if (workspace.refund_status && workspace.refund_status !== 'processed') throw new ApiError(409, 'Please wait for the existing refund request to be resolved before subscribing again.');
    if (workspace.subscription_id) {
      workspace = await sync(id);
      if (!terminal(workspace.subscription_status)) return view(id);
    }
    const subscription = await billing.create(workspace);
    if (!/^https:\/\//.test(subscription.short_url || '') || !subscription.id || subscription.notes?.workspaceId !== id || subscription.plan_id !== billing.planId) throw new ApiError(502, 'Razorpay did not return a valid checkout link. Please try again.');
    (await registry.prepare('UPDATE workspaces SET subscription_id=?,subscription_status=?,checkout_url=?,cancel_pending=0,paid_until=0,billing_policy=? WHERE id=?')
      .run(subscription.id, subscription.status, subscription.short_url, PLAN.policy, id));
    return view(id);
  }
  async function refundState(id, status, refundId = null) {
    (await registry.prepare('UPDATE refund_requests SET status=?,provider_refund_id=coalesce(?,provider_refund_id),updated_at=? WHERE workspace_id=?').run(status, refundId, now(), id));
  }
  async function reconcileRefund(id, allowSubmit = false) {
    const request = (await registry.prepare('SELECT * FROM refund_requests WHERE workspace_id=?').get(id));
    if (!request || request.status === 'processed') return;
    const payment = await billing.payment(request.payment_id);
    if (payment.id !== request.payment_id || payment.amount !== PLAN.amount || payment.currency !== PLAN.currency || !['captured', 'refunded'].includes(payment.status)) throw new ApiError(502, 'The original payment needs support review before a refund can be issued.');
    const refunds = await billing.refunds(payment.id);
    if (refunds.some(refund => refund.payment_id !== payment.id)) throw new ApiError(502, 'The refund history could not be verified.');
    // A workspace may have several failed attempts. Only this attempt's unique
    // receipt/reference can resolve an uncertain submission; an older failure
    // must not make a newer, unconfirmed POST safe to repeat.
    const matching = refunds.filter(refund => refund.receipt === request.receipt || (request.provider_refund_id && refund.id === request.provider_refund_id));
    // Some provider responses reserve the amount while the refund is pending.
    // Do not label that money as processed just from amount_refunded alone.
    const pending = matching.find(refund => refund.status === 'pending');
    if (pending) { (await refundState(id, 'pending', pending.id)); return; }
    if (refunds.some(refund => refund.status === 'pending')) { (await refundState(id, 'review_required')); return; }
    if (payment.amount_refunded === PLAN.amount && refunds.some(refund => refund.status === 'processed')) { (await refundState(id, 'processed', matching.find(refund => refund.status === 'processed')?.id)); return; }
    const existing = matching.find(refund => ['pending', 'processed'].includes(refund.status));
    if (existing) { (await refundState(id, 'pending', existing.id)); return; }
    if (matching.length && matching.every(refund => refund.status === 'failed') && request.status !== 'failed') { (await refundState(id, 'failed', matching.at(-1).id)); return; }
    // A process crash or an unknown POST response must never cause a second
    // automatic refund. Reconcile provider history; request support if absent.
    if (['submitting', 'review_required', 'pending'].includes(request.status)) { (await refundState(id, 'review_required')); return; }
    if (request.status !== 'requested' && !allowSubmit) return;
    const amount = PLAN.amount - payment.amount_refunded;
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > PLAN.amount) throw new ApiError(502, 'The refundable amount could not be verified.');
    const receipt = `rf_${randomUUID().replaceAll('-', '')}`;
    (await registry.prepare("UPDATE refund_requests SET status='submitting',receipt=?,provider_refund_id=NULL,attempted_amount=?,updated_at=? WHERE workspace_id=?").run(receipt, amount, now(), id));
    try {
      const refund = await billing.refund(payment.id, amount, receipt, id);
      if (!refund.id || refund.payment_id !== payment.id || refund.amount !== amount || !['processed', 'pending', 'failed'].includes(refund.status)) { (await refundState(id, 'review_required')); return; }
      (await refundState(id, refund.status, refund.id));
    } catch (error) {
      (await refundState(id, error.providerRejected ? 'failed' : 'review_required'));
    }
  }
  async function finishCancellation(id, allowRefundSubmit) {
    let workspace = await sync(id);
    const intent = (await registry.prepare('SELECT * FROM cancellation_requests WHERE workspace_id=? AND subscription_id=?').get(id, workspace.subscription_id));
    if (!intent) return;
    const eligible = workspace.billing_policy === PLAN.policy && workspace.first_subscription_id === workspace.subscription_id
      && workspace.first_payment_id && intent.requested_at <= workspace.refund_deadline;
    const refund = eligible || intent.kind === 'refund';
    if (eligible) (await registry.prepare(`INSERT OR IGNORE INTO refund_requests(workspace_id,subscription_id,payment_id,requested_at,status,receipt,updated_at) VALUES(?,?,?,?,'requested',?,?)`)
      .run(id, workspace.subscription_id, workspace.first_payment_id, intent.requested_at, `rf_${randomUUID().replaceAll('-', '')}`, now()));
    const atCycleEnd = !refund && workspace.paid_until > now();
    // A payment can arrive after a pending mandate was cancelled. Recheck the
    // saved request time and promote that cancellation to a refund if needed.
    (await registry.prepare('UPDATE cancellation_requests SET kind=? WHERE workspace_id=? AND subscription_id=?').run(refund ? 'refund' : 'renewal', id, workspace.subscription_id));
    if (!terminal(workspace.subscription_status) && (!intent.completed || (refund && intent.kind !== 'refund'))) {
      const result = await billing.cancel(workspace.subscription_id, atCycleEnd);
      (await saveSubscription(workspace, result));
      workspace = (await load(id));
      if (!atCycleEnd && !terminal(result.status)) throw new ApiError(502, 'Cancellation is not confirmed yet. Check the status again; no refund has been submitted.');
      (await registry.prepare('UPDATE workspaces SET cancel_pending=? WHERE id=?').run(atCycleEnd && !terminal(result.status) ? 1 : 0, id));
    }
    (await registry.prepare('UPDATE cancellation_requests SET completed=1 WHERE workspace_id=? AND subscription_id=?').run(id, workspace.subscription_id));
    if (refund) {
      (await registry.prepare('UPDATE workspaces SET paid_until=0 WHERE id=? AND subscription_id=?').run(id, workspace.first_subscription_id));
      await reconcileRefund(id, allowRefundSubmit);
    }
  }
  async function cancel(id, requestedAt = now(), refundExpected = false) {
    const workspace = (await load(id));
    if (!workspace.subscription_id) return view(id);
    const previous = (await registry.prepare('SELECT * FROM cancellation_requests WHERE workspace_id=? AND subscription_id=?').get(id, workspace.subscription_id));
    if (refundExpected && !previous && (!workspace.refund_deadline || requestedAt > workspace.refund_deadline)) throw new ApiError(409, 'The seven-day refund window has ended. Refresh Billing and review the cancellation terms before continuing.');
    (await registry.prepare('INSERT OR IGNORE INTO cancellation_requests(workspace_id,subscription_id,requested_at) VALUES(?,?,?)').run(id, workspace.subscription_id, requestedAt));
    await finishCancellation(id, true);
    return view(id);
  }
  async function refresh(id) {
    const workspace = (await load(id));
    if ((await registry.prepare('SELECT 1 FROM cancellation_requests WHERE workspace_id=? AND subscription_id=?').get(id, workspace.subscription_id))) await finishCancellation(id, false);
    else await sync(id);
    await reconcileRefund(id);
    return view(id);
  }
  return { load, view, subscribe, cancel, refresh };
}
