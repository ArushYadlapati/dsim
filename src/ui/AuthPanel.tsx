import { useMemo, useState, type FormEvent } from 'react';
import { authClient } from '../lib/authClient';
import { requestEmailVerification, requestPasswordReset } from '../lib/authFlows';
import { isEmbeddedBrowser } from '../lib/browserEnv';
import { updateUsername } from '../net/api';
import { UsernameInput, useUsernameCheck, usernameHintColor } from './UsernameField';

/** which of the three forms the modal is showing */
type AuthMode = 'in' | 'up' | 'forgot';

const TITLES: Record<AuthMode, string> = {
  in: 'Sign in',
  up: 'Create account',
  forgot: 'Reset your password',
};

/** Sign-in / sign-up modal (email+password and Google), styled to Direction A.
 * Only rendered when auth is enabled, so `authClient` is non-null. */
export function AuthPanel({ onClose }: { onClose: () => void }) {
  const client = authClient!;
  const [mode, setMode] = useState<AuthMode>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  /** the reset email has been asked for — the neutral confirmation replaces the form */
  const [resetSent, setResetSent] = useState(false);
  const uname = useUsernameCheck(username);
  // In-app webviews (LinkedIn/Instagram/… browsers) get Google's
  // `disallowed_useragent` 403 — steer them to a real browser instead.
  const embedded = useMemo(() => isEmbeddedBrowser(), []);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setError('Couldn’t copy. Long-press the address bar to copy this link.');
    }
  };

  /** switch form without carrying the previous one's error over */
  const go = (m: AuthMode): void => {
    setMode(m);
    setError('');
    setResetSent(false);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (mode === 'up' && !uname.ok) return; // username must be valid + free
    setBusy(true);
    setError('');
    try {
      if (mode === 'up') {
        await client.signUp.email({ email, password, name: name || email });
        // claim the chosen username on our own profile (server verifies the fresh
        // JWT). If it doesn't land here — e.g. the token isn't ready yet — the
        // blocking UsernameGate will prompt for it on the next load.
        try {
          await updateUsername(uname.normalized);
        } catch {
          /* gate is the fallback */
        }
        /**
         * ASK FOR THE VERIFICATION EMAIL, and do not let it decide whether the
         * sign-up succeeded. The account exists either way; a mail service having a
         * bad minute must not strand somebody on a form whose submit already worked.
         * The banner on the Profile page can resend, so the recoverable path exists
         * whatever happens here.
         *
         * ⚠️ IT DOES NOTHING UNTIL THE NEON AUTH PROJECT HAS A SENDER CONFIGURED —
         * that is an owner dashboard action (docs/deploy.md §4). The call is harmless
         * before then; it just has nothing to send with.
         */
        void requestEmailVerification(email);
      } else {
        await client.signIn.email({ email, password });
      }
      onClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : mode === 'up'
            ? 'Couldn’t create the account. Try again.'
            : 'Couldn’t sign in. Check your email and password, then try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  /**
   * "I forgot my password". Its own handler because it is the one submit here
   * that must NOT distinguish a real account from an unknown address: it shows
   * the same sentence either way, and `requestPasswordReset` answers `ok` either
   * way (see its note — an unauthenticated form that says "no such account" is an
   * enumeration oracle). Only a malformed address or an unreachable auth server
   * produces an error, and neither reveals anything.
   */
  const sendReset = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const r = await requestPasswordReset(email);
    setBusy(false);
    if (r.ok) setResetSent(true);
    else setError(r.message);
  };

  const google = async () => {
    setError('');
    try {
      await client.signIn.social({ provider: 'google', callbackURL: window.location.href });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed.');
    }
  };

  return (
    <div className="ds-modal-backdrop" onClick={onClose}>
      <div className="ds-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ds-modal-h">
          <span className="ds-panel-title">{TITLES[mode]}</span>
          <button className="ds-btn ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {mode === 'forgot' ? (
          <>
            {resetSent ? (
              <p className="ds-hint">
                If an account exists for {email.trim()}, a reset link is on its way. It works once
                and expires an hour after it is sent.
              </p>
            ) : (
              <form className="ds-form" onSubmit={sendReset}>
                <label>
                  <span>Email</span>
                  <input
                    className="ds-input"
                    type="email"
                    required
                    autoFocus
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
                {error && <div className="ds-form-err">{error}</div>}
                <button className="ds-btn primary" type="submit" disabled={busy}>
                  {busy ? 'Sending…' : 'Send reset link'}
                </button>
              </form>
            )}
            <div className="ds-form-switch">
              <button className="ds-btn ghost" onClick={() => go('in')}>Back to sign in</button>
            </div>
          </>
        ) : (
          <>
            <form className="ds-form" onSubmit={submit}>
              {mode === 'up' && (
                <>
                  <label>
                    <span>Display name</span>
                    <input className="ds-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="On the leaderboard" />
                  </label>
                  <label>
                    <span>Username</span>
                    <UsernameInput value={username} onChange={setUsername} />
                    <span className="ds-form-hint" style={{ color: usernameHintColor(uname.status) }}>
                      {uname.message}
                    </span>
                  </label>
                </>
              )}
              <label>
                <span>Email</span>
                <input className="ds-input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
              <label>
                <span>Password</span>
                <input className="ds-input" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
              </label>
              {/* Sign-in only. On the sign-up form there is no password to have
                  forgotten, and offering one there is how people end up resetting
                  an account they have not made yet. */}
              {mode === 'in' && (
                <div className="ds-form-aside">
                  <button type="button" className="ds-linkbtn" onClick={() => go('forgot')}>
                    Forgot password?
                  </button>
                </div>
              )}
              {error && <div className="ds-form-err">{error}</div>}
              <button
                className="ds-btn primary"
                type="submit"
                disabled={busy || (mode === 'up' && !uname.ok)}
              >
                {busy ? 'Working…' : mode === 'in' ? 'Sign in' : 'Create account'}
              </button>
            </form>
            {embedded ? (
              <div className="ds-form-hint" style={{ minHeight: 0 }}>
                Google sign-in doesn’t work in this app’s in-app browser. Open this page in
                Safari or Chrome to continue with Google, or use email above.
                <button
                  type="button"
                  className="ds-btn"
                  style={{ width: '100%', marginTop: 8 }}
                  onClick={copyLink}
                >
                  {copied ? 'Link copied. Paste it in your browser' : 'Copy link'}
                </button>
              </div>
            ) : (
              <button className="ds-btn" style={{ width: '100%' }} onClick={google}>Continue with Google</button>
            )}
            <div className="ds-form-switch">
              {mode === 'in' ? (
                <>New here? <button className="ds-btn ghost" onClick={() => go('up')}>Create an account</button></>
              ) : (
                <>Have an account? <button className="ds-btn ghost" onClick={() => go('in')}>Sign in</button></>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
