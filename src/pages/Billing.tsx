import { useState } from 'react';
import { useStore } from '../data/Store';
import { request } from '../data/repository';
import type { Workspace } from '../data/repository';
import { dateLabel, money } from '../domain/format';
import { Badge, Confirm, PageHeader, Panel } from '../components/ui';

const refundMessages: Record<string, string> = {
  requested: 'Your cancellation and refund request are recorded. Check the status to continue processing.',
  submitting: 'Your refund is being submitted. Check the status shortly.',
  pending: 'Your refund is pending with Razorpay. Bank credit times vary.',
  processed: 'Razorpay has processed your refund. It may take additional time to appear with your bank.',
  failed: 'The refund request failed. Retry the refund below or contact support.',
  review_required: 'The refund result needs confirmation. Check the status again or contact support. Another refund will not be sent while the result is uncertain.',
};
export default function Billing() {
  const { workspace, refresh, toast } = useStore();
  const [busy, setBusy] = useState(false);
  const [cancel, setCancel] = useState<{ refund: boolean } | null>(null);
  const [error, setError] = useState('');
  if (!workspace) return null;
  const paid = workspace.canWrite && workspace.paidUntil && new Date(workspace.paidUntil).getTime() > Date.now();
  const refundOpen = workspace.refundStatus && workspace.refundStatus !== 'processed';
  async function action(path: string, checkout = false, refundExpected = false) {
    if (busy) return false;
    setBusy(true); setError('');
    try {
      const next = await request<Workspace>(path, { billingPolicy: 'upfront_refund_v1', refundExpected });
      await refresh();
      if (checkout && next.checkoutUrl) { window.location.assign(next.checkoutUrl); return true; }
      if (next.refundStatus && next.refundForCurrentSubscription) toast(refundMessages[next.refundStatus] || 'Refund status updated.', ['failed', 'review_required'].includes(next.refundStatus));
      else toast(next.cancelPending ? 'Renewal cancellation is scheduled. Your current paid period stays available.' : next.canWrite ? 'Payment confirmed. Your workspace is active.' : 'Payment is not confirmed yet. Complete Razorpay checkout and check again.');
      return true;
    } catch (e) {
      setError((e as Error).message); await refresh().catch(() => undefined); return false;
    } finally { setBusy(false); }
  }
  return <><PageHeader title="Billing & subscription" description={`Manage the subscription for ${workspace.name}.`} />
    <Panel title="Smart Retail" subtitle="One business workspace with owner, cashier and inventory access." className="billing-panel">
      <div className="billing-content"><p className="billing-price">{money(workspace.amount / 100)} <span>per month</span></p>
        <Badge tone={workspace.canWrite ? 'green' : 'amber'}>{paid ? 'Paid access' : workspace.legacyTrial ? 'Existing free trial' : workspace.refundForCurrentSubscription ? 'Access cancelled' : 'Payment required'}</Badge>
        <p>{paid ? `Your current access is paid through ${dateLabel(workspace.paidUntil!)}.` : workspace.legacyTrial ? `Your existing free trial ends ${dateLabel(workspace.trialEndsAt, true)}. Your original trial terms are unchanged.` : 'A confirmed monthly payment is required to make changes. Your saved records remain available.'}</p>
        <dl className="billing-details"><div><dt>Workspace ID</dt><dd>{workspace.slug}</dd></div><div><dt>Subscription status</dt><dd>{workspace.status.replaceAll('_', ' ')}</dd></div></dl>
        <p className="muted">Pay ₹1,500 for your first month, then ₹1,500/month until cancelled. Cancel within seven days of the first payment for a full ₹1,500 refund and immediate access cancellation. After seven days, cancellation stops future renewals and you keep access through the paid period. Renewals do not restart the refund window.</p>
        {workspace.refundEligible && <p className="info-note">Your first payment is eligible for a full refund if you cancel by {dateLabel(workspace.refundDeadline!, true)}.</p>}
        {workspace.refundStatus && <div className="info-note" role="status"><div><strong>First-payment refund: {money(workspace.refundAmount / 100)}</strong><p>{refundMessages[workspace.refundStatus] || workspace.refundStatus}</p>{workspace.refundId && <p>Refund reference: {workspace.refundId}</p>}</div></div>}
        {!workspace.configured && <p className="info-note">Payment checkout is currently unavailable. Please contact support.</p>}
        {workspace.cancelPending && <p className="info-note">Renewal cancellation is scheduled for the end of your current paid period.</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="actions">
          {!refundOpen && (!workspace.hasSubscription || ['created', 'authenticated', 'cancelled', 'completed', 'expired'].includes(workspace.status)) && <button className="btn primary" disabled={busy || !workspace.configured} onClick={() => void action('/billing/subscribe', true)}>{busy ? 'Opening checkout...' : 'Pay ₹1,500 & activate'}</button>}
          {workspace.hasSubscription && <button className="btn" disabled={busy} onClick={() => void action('/billing/refresh')}>{busy ? 'Checking...' : refundOpen ? 'Check refund status' : 'Check payment status'}</button>}
          {workspace.refundStatus === 'failed' && <button className="btn" disabled={busy} onClick={() => void action('/billing/cancel')}>Retry refund</button>}
          {workspace.hasSubscription && !workspace.cancelPending && !workspace.refundForCurrentSubscription && ['created', 'authenticated', 'active', 'pending', 'halted'].includes(workspace.status) && <button className="btn" disabled={busy} onClick={() => setCancel({ refund: workspace.refundEligible })}>{workspace.refundEligible ? 'Cancel & request ₹1,500 refund' : 'Cancel renewal'}</button>}
        </div>
      </div>
    </Panel>
    {cancel && <Confirm title={cancel.refund ? 'Cancel and refund your first month?' : 'Cancel subscription renewal?'} label={cancel.refund ? 'Cancel & request refund' : 'Cancel renewal'} description={cancel.refund ? 'Your subscription and editing access end immediately. We will request a full ₹1,500 refund to the original payment method. Bank credit times vary. Your saved records will be retained.' : 'Future renewals will stop. You keep access through your paid period. This cancellation does not include a refund.'} onClose={() => setCancel(null)} onConfirm={async () => { if (await action('/billing/cancel', false, cancel.refund)) setCancel(null); else throw new Error('Cancellation could not be confirmed. Please check the message and try again.'); }} />}
  </>;
}
