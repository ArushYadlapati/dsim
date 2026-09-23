import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { authClient } from '../lib/authClient';
import { describeAuthError, requestEmailVerification, requestPasswordReset } from '../lib/authFlows';
import { isEmbeddedBrowser } from '../lib/browserEnv';
import { acceptTerms, updateUsername } from '../net/api';
import { TermsAgreement } from './TermsGate';
import { UsernameInput, useUsernameCheck, usernameHintClass } from './UsernameField';
import { CloseGlyph } from './FriendsPanel';
import { useDialog } from './useDialog';

/** which of the three forms the modal is showing */
type AuthMode = 'in' | 'up' | 'forgot';

/** the panel title's element id, so `aria-labelledby` on the dialog can point at it */
const TITLE_ID = 'ds-auth-title';
/** the username hint's id, for the input's `aria-describedby` */
const UNAME_HINT_ID = 'ds-auth-uname-hint';

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
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  /** the reset email has been asked for — the neutral confirmation replaces the form */
  const [resetSent, setResetSent] = useState(false);
  /** the required Terms + Privacy box on the sign-up form */
  const [agreed, setAgreed] = useState(false);
  const uname = useUsernameCheck(username);
  // In-app webviews (LinkedIn/Instagram/… browsers) get Google's
  // `disallowed_useragent` 403 — steer them to a real browser instead.
  const embedded = useMemo(() => isEmbeddedBrowser(), []);
  // Esc closes, same as the ✕ — this modal is dismissible (unlike the blocking gates), so
  // the keyboard needs the exit the mouse already has. `useDialog` also traps Tab and hands
  // focus back to the "Sign in" button that opened it.
  const dialogRef = useDialog(onClose);
  /* THE FIRST FIELD TAKES FOCUS on open AND on every switch of form: the button that switched
     it has just unmounted, which would drop focus to <body>, outside the Tab trap. The panel
     itself (tabIndex -1) is the fallback for the reset-sent sentence, which has no field. */
  useEffect(() => {
    const el = dialogRef.current;
    (el?.querySelector<HTMLElement>('input') ?? el)?.focus();
  }, [mode, resetSent, dialogRef]);
  /* A BACKDROP CLICK CLOSES ONLY AN UNTOUCHED FORM. On a phone the 380px card leaves a lot
     of scrim, and a stray tap there used to throw away a half-typed sign-up. The ✕ and Esc
     are deliberate, so they still close whatever is typed. */
  const touched = !!(email || password || username || agreed);

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
    /**
     * THE BOX IS REQUIRED, AND THE BUTTON STAYS LIVE.
     *
     * A disabled submit would leave somebody pressing a dead button with nothing
     * saying why, and the native `required` attribute answers with a browser tooltip
     * in the browser’s own words rather than ours. So the form submits, and this
     * says what is missing.
     */
    if (mode === 'up' && !agreed) {
      setError(
        'Accept the Terms of Use and Privacy Policy to create an account.',
      );
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (mode === 'up') {
        // ONE NAME ON SIGN-UP (design review 08-10). A "Display name" field above the username
        // asked for a name twice without saying why, took any length, and fell back to the
        // email ADDRESS, which then showed on the leaderboard. The username (already 4–20 and
        // moderated) seeds the display name; Appearance changes it.
        await client.signUp.email({ email, password, name: uname.normalized });
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
        /**
         * RECORD THE ACCEPTANCE the box above just made. Same shape as the username
         * write beside it, and the same fallback: if the token is not ready yet, or
         * this server predates the route, `TermsGate` asks on the next load. What it
         * must not do is fail the sign-up — the account exists and the box was ticked.
         */
        try {
          await acceptTerms();
        } catch {
          /* TermsGate is the fallback */
        }
      } else {
        await client.signIn.email({ email, password });
      }
      onClose();
    } catch (err) {
      // ⚠️ NOT `err.message`. The SDK's own wording reached this form unedited — a dropped
      // connection printed "Failed to fetch" under a sign-in button. `describeAuthError`
      // answers the app's sentence for the failures it can name and hands back the one
      // below, which names the ACTION, for anything it cannot.
      setError(
        describeAuthError(
          err,
          mode === 'up'
            ? 'Couldn’t create the account. Try again.'
            : 'Couldn’t sign in. Check your email and password, then try again.',
        ),
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
      // same reason as `submit` — the raw SDK message is not this app's voice
      setError(describeAuthError(err, 'Couldn’t start Google sign-in. Try again in a moment.'));
    }
  };

  return (
    <div className="ds-modal-backdrop" onClick={touched ? undefined : onClose}>
      {/* the DIALOG is the panel, not the backdrop: the backdrop is the click-away scrim and
          naming it the dialog would put everything behind it inside the modal boundary. */}
      <div
        ref={dialogRef}
        className="ds-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ds-modal-h">
          <h2 className="ds-dialog-title" id={TITLE_ID}>{TITLES[mode]}</h2>
          <button className="ds-btn ghost small" onClick={onClose} aria-label="Close"><CloseGlyph /></button>
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
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
                {/* the reserved status line (ui-standard §1.4): a failed attempt does not grow the form */}
                <div className={`ds-form-hint${error ? ' err' : ''}`} role="alert">{error}</div>
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
                  {/* the hint sits OUTSIDE the label, as on the username gate: inside, its
                      text would be read into the input's name as well as its description */}
                  <label>
                    <span>Username</span>
                    <UsernameInput value={username} onChange={setUsername} hintId={UNAME_HINT_ID} status={uname.status} />
                  </label>
                  <span
                    className={`ds-form-hint ${usernameHintClass(uname.status)}`}
                    id={UNAME_HINT_ID}
                    aria-live="polite"
                  >
                    {uname.message}
                  </span>
                </>
              )}
              <label>
                <span>Email</span>
                <input className="ds-input" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
              <label>
                <span>Password</span>
                <input
                  className="ds-input"
                  type="password"
                  required
                  autoComplete={mode === 'up' ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
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
              {/* REQUIRED. The same sentence the blocking gate shows, from the same
                  component, so the two places that ask cannot ask different things.
                  `aria-required` rather than `required`: the refusal is ours, above. */}
              {mode === 'up' && (
                <label className="ds-checkline">
                  <input
                    type="checkbox"
                    checked={agreed}
                    aria-required="true"
                    aria-invalid={!agreed && !!error}
                    onChange={(e) => {
                      setAgreed(e.target.checked);
                      if (e.target.checked) setError('');
                    }}
                  />
                  <span>
                    <TermsAgreement />
                  </span>
                </label>
              )}
              <div className={`ds-form-hint${error ? ' err' : ''}`} role="alert">{error}</div>
              <button
                className="ds-btn primary"
                type="submit"
                disabled={busy || (mode === 'up' && !uname.ok)}
              >
                {busy
                  ? mode === 'in' ? 'Signing in…' : 'Creating account…'
                  : mode === 'in' ? 'Sign in' : 'Create account'}
              </button>
            </form>
            {embedded ? (
              <div className="ds-form-hint">
                Google sign-in doesn’t work in this app’s in-app browser. Open this page in
                Safari or Chrome to continue with Google, or use email above.
                <button
                  type="button"
                  className="ds-btn ds-form-alt"
                  onClick={copyLink}
                >
                  {copied ? 'Link copied. Paste it in your browser' : 'Copy link'}
                </button>
              </div>
            ) : (
              <button className="ds-btn ds-form-alt" onClick={google}>Continue with Google</button>
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
