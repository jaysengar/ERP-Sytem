import { request } from '../data/repository';
import { Dialog, Field, Form } from './ui';
import { useStore } from '../data/Store';
export function ChangePassword({ onClose }: { onClose: () => void }) {
  const { toast } = useStore();
  return <Dialog title="Change password" onClose={onClose}><Form submitLabel="Save password" onCancel={onClose} onSubmit={async data => {
    const password = String(data.get('password') || '');
    if (password !== String(data.get('confirmation') || '')) throw new Error('The new passwords do not match.');
    await request('/auth/password', { currentPassword: String(data.get('currentPassword') || ''), password });
    toast('Password changed. Other sessions have been signed out.'); onClose();
  }}><div className="form-grid">
    <Field label="Current password" className="span-2"><input name="currentPassword" type="password" autoComplete="current-password" required autoFocus /></Field>
    <Field label="New password" className="span-2" hint="Use 12 to 128 characters."><input name="password" type="password" minLength={12} maxLength={128} autoComplete="new-password" required /></Field>
    <Field label="Confirm new password" className="span-2"><input name="confirmation" type="password" minLength={12} maxLength={128} autoComplete="new-password" required /></Field>
  </div></Form></Dialog>;
}
