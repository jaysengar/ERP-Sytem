import { useState } from 'react';
import { ShoppingBag } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { getWorkspace, request, setWorkspace } from '../data/repository';
import { Field, Form, textValue } from './ui';

export function Auth({ onSuccess }: { onSuccess: () => Promise<void> }) {
  const navigate = useNavigate();
  const [setup, setSetup] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  return <main className="auth-page"><section className="auth-panel" aria-labelledby="auth-title">
    <div className="brand"><span className="brand-mark"><ShoppingBag size={23} aria-hidden="true" /></span><span>smart<span className="brand-light">retail</span></span></div>
    <h1 id="auth-title">{setup ? 'Open your store workspace' : 'Welcome back'}</h1>
    <p className="auth-intro">{setup ? 'Your own workspace, inventory and team. Pay ₹1,500 for your first month, with a 7-day money-back guarantee.' : 'Sign in to your business workspace to manage stock and sales.'}</p>
    <Form key={String(setup)} submitLabel={setup ? 'Continue to payment · ₹1,500' : 'Sign in'} onSubmit={async data => {
      const password = String(data.get('password') || '');
      if (setup && password !== String(data.get('confirmPassword') || '')) throw new Error('The passwords do not match. Please enter them again.');
      const slug = textValue(data, 'slug').toLowerCase();
      if (setup) {
        const result = await request<{ slug: string; checkoutUrl: string | null }>('/public/register', { slug, shopName: textValue(data, 'shopName'), email: textValue(data, 'email'), password, name: textValue(data, 'name'), sampleData: data.get('sampleData') === 'on', acceptTerms: data.get('acceptTerms') === 'on', billingPolicy: 'upfront_refund_v1' });
        setWorkspace(result.slug);
        await onSuccess();
        navigate('/billing', { replace: true });
        if (result.checkoutUrl) window.location.assign(result.checkoutUrl);
        return;
      } else { setWorkspace(slug); await request('/auth/login', { email: textValue(data, 'email'), password }); }
      await onSuccess();
    }}><div className="form-grid">
      {setup && <Field label="Business name" className="span-2"><input name="shopName" autoComplete="organization" maxLength={100} required autoFocus /></Field>}
      <Field label="Workspace ID" className="span-2" hint={setup ? 'Choose 3–40 lowercase letters, numbers or hyphens. Share this ID with your team.' : 'The workspace ID shared by your store owner.'}><input name="slug" defaultValue={setup ? '' : getWorkspace()} pattern="[a-z0-9][a-z0-9-]{2,39}" autoCapitalize="none" autoCorrect="off" maxLength={40} required /></Field>
      {setup && <Field label="Your name" className="span-2"><input name="name" autoComplete="name" maxLength={80} required /></Field>}
      <Field label="Email address" className="span-2"><input name="email" type="email" autoComplete="username" maxLength={200} required autoFocus={!setup} /></Field>
      <Field label="Password" className="span-2" hint={setup ? 'Use at least 12 characters. A few memorable words work well.' : undefined}><input name="password" type={showPassword ? 'text' : 'password'} autoComplete={setup ? 'new-password' : 'current-password'} minLength={setup ? 12 : undefined} maxLength={128} required /></Field>
      {setup && <Field label="Confirm password" className="span-2"><input name="confirmPassword" type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={12} maxLength={128} required /></Field>}
      <label className="checkbox-label span-2"><input type="checkbox" checked={showPassword} onChange={event => setShowPassword(event.target.checked)} />Show password</label>
      {setup && <label className="checkbox-label span-2"><input name="sampleData" type="checkbox" />Include fictional sample products and sales for testing</label>}
      {setup && <label className="checkbox-label span-2"><input name="acceptTerms" type="checkbox" required />I agree to pay ₹1,500 now and renew at ₹1,500/month. Cancel within 7 days of the first payment for a full ₹1,500 refund and immediate access cancellation. After 7 days, cancellation only stops future renewals.</label>}
    </div></Form>
    <p className="auth-help">{setup ? 'Complete payment securely on Razorpay to activate your workspace. The seven-day refund window starts when your first payment is confirmed.' : 'Need access or a password reset? Ask your store owner.'}</p>
    <button className="text-link auth-switch" onClick={() => setSetup(!setup)}>{setup ? 'Already have a workspace? Sign in' : 'New business? Get started'}</button>
  </section></main>;
}
