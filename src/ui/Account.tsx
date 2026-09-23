import { useEffect, useState } from 'react';
import { ToggleRow } from './OptRow';
import { LinkedAccounts } from './LinkedAccounts';
import { StarReward } from './StarReward';
import type { GameSettings } from '../game';
import { defaultSettings } from '../settings';
import { authEnabled, authClient } from '../lib/authClient';
import { requestPasswordReset } from '../lib/authFlows';
import { multiServer, selectedServerId } from '../net/env';
import {
  deleteMyAccount,
  fetchEntitlements,
  fetchReplaysPublic,
  saveReplaysPublic,
  type Entitlements,
} from '../net/api';
import { AuthDisabled } from './AuthDisabled';
import { AuthPanel } from './AuthPanel';
import { copyText } from './copyText';
import { DesktopUpdate } from './DesktopUpdate';
import { fmtDay } from './fmtDate';
import { ProfileTabs, type ProfileTab } from './ProfileTabs';
import { ServerMenu } from './ServerMenu';
import { VerifyEmailBanner } from './VerifyEmailBanner';
import { SUPPORT_ENABLED } from '../net/env';
import { LEGAL_CONTACT } from '../legalText';
import { trackEvent } from '../analytics';

/**
 * ACCOUNT — the account itself: sign in / out (Neon Auth), email and password, the default
 * server region, linked accounts, privacy, membership, a settings reset and deletion.
 *
 * HOW YOU APPEAR TO OTHERS — name, title, badges, rewards, robot look — is the OTHER page of
 * this destination, `Appearance` (owner, 2026-09-22: "Profile account settings should be
 * separated from like profile title and cosmetics settings"). Audio and controls live in
 * `Configure`. Auth is a stable module constant, so the `authEnabled` branch that skips the
 * session hook is safe.
 */
export function Account({
  settings,
  onChange,
  onDonate,
  onTab,
}: {
  settings: GameSettings;
  onChange: (s: GameSettings) => void;
  /** navigate to the Support page — the membership card links to it rather than
   * duplicating the tier pitch here */
  onDonate?: () => void;
  /** the Appearance | Account strip */
  onTab?: (t: ProfileTab) => void;
}) {
  return (
    <>
      <h1 className="ds-h1">Profile</h1>
      <ProfileTabs active="account" onPick={onTab} />

      {/* ABOVE the identity panel, because it is about the address that panel shows,
          and because this is the page the ranked refusal sends people to. */}
      {authEnabled && <VerifyEmailBanner />}

      {authEnabled ? <Identity /> : <IdentityDisabled />}

      {multiServer() && (
        // `ds-panel-open` drops the panel's `overflow: hidden` so the region
        // dropdown can escape below the card instead of being clipped by it.
        <div className="ds-panel ds-panel-open">
          <div className="ds-panel-h">
            <h2 className="ds-panel-title">Server</h2>
          </div>
          <div className="ds-panel-body">
            <ServerMenu
              value={settings.preferredServerId ?? selectedServerId()}
              onChange={(id) => onChange({ ...settings, preferredServerId: id })}
            />
          </div>
        </div>
      )}

      <DesktopUpdate />

      {/* ⚠️ `StarReward` ABOVE `LinkedAccounts`, and both facts matter. It has to MOUNT first
          because `LinkedAccounts` strips `?link` from the URL once it has read it, and it has to
          READ first because this is the thing somebody is coming back to see. The reward itself
          arrives through the claim dialog; this panel only says what to do when there is none. */}
      {authEnabled && <StarReward />}
      {authEnabled && <LinkedAccounts />}
      {authEnabled && <ReplayPrivacy />}

      {authEnabled && SUPPORT_ENABLED && <Membership onDonate={onDonate} />}

      <div className="ds-panel">
        <div className="ds-panel-h">
          <h2 className="ds-panel-title">Reset settings</h2>
        </div>
        <div className="ds-panel-body stack start">
          {/* `danger`: it wipes builds, autos and bindings, which for a local-only player is
              more loss than deleting the account. The confirm names every one of them. */}
          <button
            className="ds-btn danger"
            onClick={() => {
              if (
                confirm(
                  'Reset every setting? This clears your robot build, saved robots, imported autos, ' +
                    'saved start positions, key bindings, audio and mobile layout. It cannot be undone.',
                )
              ) {
                onChange(defaultSettings());
              }
            }}
          >
            Reset all settings
          </button>
        </div>
      </div>

      {authEnabled && <DeleteAccount />}
    </>
  );
}

/**
 * REPLAY PRIVACY — the one account setting that changes what STRANGERS can see.
 *
 * Match replays are private by default (migration 0037). A replay is an input log
 * re-simulated at full fidelity, so it is not a highlight, it is the game plan: where you
 * start, what you go for first, when you leave for the endgame. That is scouting material,
 * and it used to be one click from any leaderboard row.
 *
 * ⚠️ THE COPY MUST SAY THAT ONE PLAYER CANNOT PUBLISH A MATCH. A toggle labelled "make my
 * replays public" that quietly does nothing for most matches is worse than no toggle — the
 * release rule is unanimous consent, because the log shows the opponent's half too. Nobody
 * will infer that from a switch, so the panel states it.
 *
 * It does NOT cover record runs. Those are leaderboard submissions whose replay is the proof
 * behind the number, so they stay watchable and this setting never claims otherwise.
 */
function ReplayPrivacy() {
  const session = authClient!.useSession();
  const userId = session.data?.user?.id ?? null;
  const [value, setValue] = useState<boolean | null>(null);
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle');

  useEffect(() => {
    if (!userId) {
      setValue(null);
      return;
    }
    let cancelled = false;
    void fetchReplaysPublic()
      .then((r) => {
        if (!cancelled) setValue(r.replaysPublic);
      })
      .catch(() => {
        if (!cancelled) setValue(null);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (!userId) return null;

  const toggle = (next: boolean): void => {
    // OPTIMISTIC, and it rolls back on failure. The alternative is a switch that does not
    // move until a round trip lands, which reads as a dead control.
    const prev = value;
    setValue(next);
    setStatus('saving');
    void saveReplaysPublic(next)
      .then(() => setStatus('idle'))
      .catch(() => {
        setValue(prev);
        setStatus('error');
      });
  };

  return (
    <div className="ds-panel">
      <div className="ds-panel-h">
        <h2 className="ds-panel-title">Privacy</h2>
      </div>
      <div className="ds-panel-body stack start">
        <p className="ds-hint">
          Only the people who played in a match can watch it back. Your results, scores and
          rating stay on your public profile.
        </p>
        {value === null ? (
          <p className="ds-hint">Checking…</p>
        ) : (
          <>
            <ToggleRow
              label="Match replays"
              value={value}
              onPick={toggle}
              off="Private"
              on="Anyone can watch"
            />
            <p className="ds-hint">
              A replay shows both alliances, so a match only becomes public when everyone who
              played in it has turned this on. Turning it off again hides every match of yours
              that was shared this way.
            </p>
          </>
        )}
        {status === 'error' && (
          <p className="ds-hint warn">Couldn’t save that. Check your connection and try again.</p>
        )}
      </div>
    </div>
  );
}

/**
 * Membership status.
 *
 * Lives here rather than only on the Donate page because "when does my
 * subscription run out, and is it going to renew?" is an ACCOUNT question, and
 * making someone visit a page titled "Support DSIM" to answer it reads as a
 * second sales pitch. It also surfaces the one state a supporter genuinely needs
 * warning about: a membership that is active but NOT linked to a Ko-fi address,
 * which will simply stop at the end of the period with no renewal.
 */
function Membership({ onDonate }: { onDonate?: () => void }) {
  const [ent, setEnt] = useState<Entitlements | null>(null);
  const session = authClient!.useSession();
  const userId = session.data?.user?.id ?? null;

  useEffect(() => {
    if (!userId) {
      setEnt(null);
      return;
    }
    let cancelled = false;
    void fetchEntitlements().then((e) => {
      if (!cancelled) setEnt(e);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (!userId) return null;
  const until = ent?.supporterUntil ? new Date(ent.supporterUntil) : null;

  return (
    <div className="ds-panel">
      <div className="ds-panel-h">
        <h2 className="ds-panel-title">Membership</h2>
        {ent?.supporter && <span className="ds-count">supporter</span>}
      </div>
      <div className="ds-panel-body stack start">
        {!ent ? (
          <p className="ds-hint">Checking…</p>
        ) : ent.supporter ? (
          <>
            <p className="ds-hint">
              Supporter{until ? ` until ${fmtDay(until)}` : ''} ·{' '}
              {ent.autoRenews ? 'renews automatically' : 'will not renew'}
            </p>
            {!ent.autoRenews && (
              <p className="ds-hint warn">
                This membership isn’t linked to a Ko-fi account, so it will stop at the end of the
                period. Claim a payment on the Support page to link it.
              </p>
            )}
          </>
        ) : (
          <p className="ds-hint">No membership.</p>
        )}
        {onDonate && (
          <button className="ds-btn ghost" onClick={onDonate}>
            {ent?.supporter ? 'Manage membership' : 'Support DSIM'}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Account deletion.
 *
 * The privacy policy promises this, which means it has to be a button rather
 * than an inbox commitment someone honours by hand when they get round to it.
 *
 * Two guards, because it is irreversible and cascades across every table: a
 * typed confirmation (not an OK/Cancel dialog anyone can dismiss by muscle
 * memory) and an explicit note about what SURVIVES — a promise to erase
 * everything would be a lie, since a completed match's result still involves the
 * other players and financial records have to outlive the account.
 */
/**
 * ⚠️ EXPORTED, and rendered in TWO places: here, and in the privacy page's "Your data" panel
 * (`src/ui/YourData.tsx`). Deliberately the same component rather than a second button that
 * posts to the same route: the typed confirmation and the paragraph about what SURVIVES a
 * deletion are the load-bearing parts, and two copies of that copy would drift — which is the
 * exact failure the storage registry exists to stop one file over.
 */
export function DeleteAccount() {
  const session = authClient!.useSession();
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!session.data?.user) return null;

  const doDelete = async (): Promise<void> => {
    if (confirm !== 'DELETE' || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await deleteMyAccount();
      trackEvent('account_deleted');
      // Sign out AFTER the server confirms: signing out first would drop the very
      // token the delete request needs.
      await authClient!.signOut();
      location.href = '/';
    } catch (e) {
      // The route can be MISSING rather than broken: one Fly app serves every
      // client version, so a client deployed ahead of the server gets a 404 here.
      // The privacy policy promises deletion either way, so a failure has to fall
      // back to the promise we can always keep - a human answering the mailbox -
      // rather than leaving someone stuck on a button that does nothing.
      const msg = e instanceof Error ? e.message : '';
      setErr(
        /404|not found|unavailable/i.test(msg)
          ? `Self-service deletion isn’t available on this server yet. Email ${LEGAL_CONTACT} and your account will be deleted.`
          : msg || 'Couldn’t delete the account.',
      );
      setBusy(false);
    }
  };

  return (
    <div className="ds-panel">
      <div className="ds-panel-h">
        <h2 className="ds-panel-title">Delete account</h2>
      </div>
      <div className="ds-panel-body stack">
        <p className="ds-hint">
          Permanently deletes your profile, username, saved settings and robot presets, records
          and practice runs with their replays, ranked rating and history, your playtime and
          account standing, and every friendship, block, and invite. This cannot be undone.
        </p>
        <p className="ds-hint">
          Matches you played stay on other players' history without your name, and payment records
          are kept (without your email) because they are financial records. Your sign-in identity
          itself lives with our authentication provider. Delete it there too if you want it gone.
        </p>
        <div className="ds-claim-row">
          <input
            className="ds-input"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Type DELETE to confirm"
            aria-label="Type DELETE to confirm account deletion"
          />
          <button
            className="ds-btn danger"
            disabled={busy || confirm !== 'DELETE'}
            onClick={() => void doDelete()}
          >
            {busy ? 'Deleting…' : 'Delete my account'}
          </button>
        </div>
        {err && (
          <p className="ds-claim-msg err" role="status">
            {err}
          </p>
        )}
      </div>
    </div>
  );
}

function Identity() {
  const client = authClient!;
  const session = client.useSession();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const user = session.data?.user;

  /** the flash is driven by whether the text ACTUALLY landed — see `copyText`: the
   *  clipboard API is absent on a plain-http LAN page, and "Copied" over a copy that
   *  never happened is worse than no button. */
  const copyId = (): void => {
    if (!user?.id) return;
    copyText(user.id, (ok) => {
      if (!ok) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };

  return (
    <div className="ds-panel">
      <div className="ds-panel-h">
        <h2 className="ds-panel-title">Account</h2>
        {session.isPending && <span className="ds-chip">…</span>}
      </div>
      {user ? (
        <div className="ds-panel-body stack">
          <div className="ds-field-row">
            <span className="ds-acct-email">{user.email ?? 'signed in'}</span>
            <span className="ds-head-spacer" />
            <button className="ds-btn ghost" onClick={() => client.signOut()}>
              Sign out
            </button>
          </div>
          {user.email && <PasswordRow email={user.email} />}
          <div className="ds-acct-id">
            <p className="ds-hint">Account ID</p>
            <div className="ds-field-row">
              {/* not clickable: the Copy button beside it is the control (a click-only
                  <code> was mouse-only) */}
              <code className="ds-acct-uuid">
                {user.id}
              </code>
              <button
                type="button"
                className="ds-btn ghost small"
                onClick={copyId}
                title="Copy Account ID"
                aria-label="Copy Account ID"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="ds-panel-body row">
          <p className="ds-hint">Sign in to save records and rank up.</p>
          <span className="ds-head-spacer" />
          <button className="ds-btn primary" onClick={() => setOpen(true)}>
            Sign in
          </button>
        </div>
      )}
      {open && <AuthPanel onClose={() => setOpen(false)} />}
    </div>
  );
}

/**
 * PASSWORD — a reset link to the account's own address. Sign-in lives with the auth provider,
 * so a password is changed through the same emailed-link flow as a forgotten one
 * (`requestPasswordReset`, `src/lib/authFlows.ts`), rather than by a form here that would
 * have to hold the old password.
 */
function PasswordRow({ email }: { email: string }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [msg, setMsg] = useState('');
  const send = async (): Promise<void> => {
    setState('sending');
    const r = await requestPasswordReset(email);
    if (r.ok) {
      setState('sent');
    } else {
      setMsg(r.message);
      setState('error');
    }
  };
  return (
    <>
      <div className="ds-field-row">
        <span className="ds-hint">
          {state === 'sent' ? `A link to set a new password is on its way to ${email}.` : 'Password'}
        </span>
        <span className="ds-head-spacer" />
        <button className="ds-btn ghost small" disabled={state === 'sending' || state === 'sent'} onClick={() => void send()}>
          {state === 'sending' ? 'Sending…' : 'Change password'}
        </button>
      </div>
      {state === 'error' && <p className="ds-hint warn">{msg}</p>}
    </>
  );
}

/** the same panel the reset and verify screens show — see `AuthDisabled`. */
function IdentityDisabled() {
  return <AuthDisabled />;
}
