import { useState, type FormEvent } from 'react';
import { authEnabled } from '../lib/authClient';
import {
  completePasswordReset,
  PASSWORD_MIN,
  requestPasswordReset,
  type AuthFlowResult,
} from '../lib/authFlows';
import { AuthDisabled } from './AuthDisabled';
import { AuthPanel } from './AuthPanel';
import { ENTRY_TOKEN } from './entryToken';

/**
 * `/account/reset` — the screen the password-reset email lands on.
 *
 * TWO SHAPES, decided by whether the URL carried a token:
 *
 *  · WITH a token (the normal path, arriving from the email) — pick a new
 *    password, twice, and it is set.
 *  · WITHOUT one — the request form instead, rather than an error. People reach
 *    this URL by typing it, by opening a link whose query a mail client ate, or by
 *    coming back to a stale tab, and every one of those wants the same thing: send
 *    me a link. The sign-in modal has the same entry point; this is the copy of it
 *    that survives being bookmarked.
 *
 * ⚠️ THE CONFIRMATION IS NEUTRAL, AND THAT IS THE POINT. It never says whether an
 * account exists for the address, because an unauthenticated form that does is an
 * account-enumeration oracle — feed it a list and it tells you who has an account
 * here. `requestPasswordReset` answers `ok` for any well-formed address for the
 * same reason (see its own note).
 *
 * The reset itself does NOT create a session — Better Auth's `resetPassword`
 * answers `{status}` and nothing else — so success ends on sign-in rather than
 * pretending to be signed in. The modal opens right here, so it is one click
 * rather than a trip back through the menu.
 */
export function AccountReset({ onAccount }: { onAccount: () => void }) {
  return (
    <>
      <h1 className="ds-h1">Reset your password</h1>
      {!authEnabled ? (
        <AuthDisabled />
      ) : ENTRY_TOKEN ? (
        <SetNewPassword token={ENTRY_TOKEN} onAccount={onAccount} />
      ) : (
        <RequestLink />
      )}
    </>
  );
}

/** no token on the URL ⇒ offer to send one. Same neutral answer as the modal. */
function RequestLink() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const r = await requestPasswordReset(email);
    setBusy(false);
    if (r.ok) setSent(true);
    else setError(r.message);
  };

  return (
    <div className="ds-panel">
      <div className="ds-panel-h">
        <span className="ds-panel-title">Email a reset link</span>
      </div>
      <div className="ds-panel-body stack start">
        {sent ? (
          <p className="ds-hint">
            If an account exists for {email.trim()}, a reset link is on its way. It works once and
            expires an hour after it is sent.
          </p>
        ) : (
          <form className="ds-form" onSubmit={submit}>
            <label>
              <span>Email</span>
              <input
                className="ds-input"
                type="email"
                required
                autoFocus
                autoComplete="email"
                value={email}
                onChange={(ev) => setEmail(ev.target.value)}
              />
            </label>
            <div className={`ds-form-hint${error ? ' err' : ''}`}>{error}</div>
            <button className="ds-btn primary" type="submit" disabled={busy}>
              {busy ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

/** the token path: choose the new password. */
function SetNewPassword({ token, onAccount }: { token: string; onAccount: () => void }) {
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AuthFlowResult | null>(null);
  const [signIn, setSignIn] = useState(false);

  const tooShort = pw.length > 0 && pw.length < PASSWORD_MIN;
  const mismatch = again.length > 0 && again !== pw;
  const canSubmit = pw.length >= PASSWORD_MIN && again === pw && !busy;
  const failed = result && !result.ok ? result : null;

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setResult(null);
    const r = await completePasswordReset(token, pw);
    setBusy(false);
    setResult(r);
  };

  if (result?.ok) {
    return (
      <div className="ds-panel">
        <div className="ds-panel-h">
          <span className="ds-panel-title">Password changed</span>
        </div>
        <div className="ds-panel-body stack start">
          <p className="ds-hint">Your password is set. Sign in with it to carry on.</p>
          <button className="ds-btn primary" onClick={() => setSignIn(true)}>
            Sign in
          </button>
        </div>
        {signIn && <AuthPanel onClose={onAccount} />}
      </div>
    );
  }

  /* Local checks first — a short or mismatched password should never cost a round
     trip — then whatever the server said. ONE line, always present (`.ds-form-hint`
     reserves 1em), so the panel does not change height when it fills. */
  const message = tooShort
    ? `Passwords need at least ${PASSWORD_MIN} characters.`
    : mismatch
      ? 'Those two don’t match.'
      : (failed?.message ?? '');

  return (
    <div className="ds-panel">
      <div className="ds-panel-h">
        <span className="ds-panel-title">Choose a new password</span>
      </div>
      <div className="ds-panel-body stack start">
        <form className="ds-form" onSubmit={submit}>
          <label>
            <span>New password</span>
            <input
              className="ds-input"
              type="password"
              required
              autoFocus
              autoComplete="new-password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
            />
          </label>
          <label>
            <span>New password again</span>
            <input
              className="ds-input"
              type="password"
              required
              autoComplete="new-password"
              value={again}
              onChange={(e) => setAgain(e.target.value)}
            />
          </label>
          <div className={`ds-form-hint${message ? ' err' : ''}`}>{message}</div>
          <button className="ds-btn primary" type="submit" disabled={!canSubmit}>
            {busy ? 'Saving…' : 'Set password'}
          </button>
        </form>
        {failed?.reason === 'invalid-token' && (
          <p className="ds-hint">
            Reset links work once and expire an hour after they are sent. Ask for a new one from
            the sign-in form.
          </p>
        )}
      </div>
    </div>
  );
}
