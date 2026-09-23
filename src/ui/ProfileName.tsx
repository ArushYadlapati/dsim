import { useEffect, useState } from 'react';
import { gameServerConfigured } from '../net/env';
import { fetchProfile, updateHandle, updateUsername } from '../net/api';
import { UsernameInput, useUsernameCheck, usernameHintClass } from './UsernameField';

/*
 * THE NAME YOU ARE SHOWN BY — the display name every board prints and the unique @username a
 * profile URL is built from. They moved here from the Account page when it split
 * (owner, 2026-09-22): both are how you APPEAR to other players, which is what the Appearance
 * page is for, and neither is a setting of the account behind them. Unchanged otherwise.
 */

/** editable public display name (the leaderboard/profile handle) */
export function DisplayName({
  userId,
  fallback,
  onSaved,
}: {
  userId: string;
  fallback: string;
  onSaved?: (handle: string) => void;
}) {
  const configured = gameServerConfigured();
  const [name, setName] = useState(fallback);
  const [saved, setSaved] = useState(fallback);
  const [status, setStatus] = useState<'idle' | 'saving' | 'ok' | 'error'>('idle');
  const [error, setError] = useState('');

  // load the current handle from the server (may differ from the auth name)
  useEffect(() => {
    if (!configured) return;
    let alive = true;
    fetchProfile(userId)
      .then((p) => {
        if (!alive || !p.handle) return;
        setName(p.handle);
        setSaved(p.handle);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [userId, configured]);

  const trimmed = name.trim();
  const dirty = trimmed !== saved;
  const valid = trimmed.length >= 2 && trimmed.length <= 24;

  const save = (): void => {
    if (!dirty || !valid) return;
    setStatus('saving');
    setError('');
    updateHandle(trimmed)
      .then((r) => {
        setSaved(r.handle);
        setName(r.handle);
        setStatus('ok');
        onSaved?.(r.handle);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setStatus('error');
      });
  };

  return (
    <div className="ds-panelbox">
      <label className="ds-field">
        <span className="cap">
          Display name <span className={`val${valid ? '' : ' over'}`}>{trimmed.length}/24</span>
        </span>
        <div className="ds-field-row">
          <input
            className="ds-input grow"
            type="text"
            maxLength={24}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (status !== 'idle') setStatus('idle');
            }}
            placeholder="Shown on leaderboards"
          />
          <button
            className={`ds-btn primary${status === 'saving' ? ' busy' : ''}`}
            disabled={!dirty || !valid || status === 'saving'}
            aria-busy={status === 'saving'}
            onClick={save}
          >
            Save
          </button>
        </div>
      </label>
      <p className="ds-hint">
        {!configured && 'Editing needs the game server. '}
        {status === 'ok' && !dirty && <span className="ok">Saved.</span>}
        {status === 'error' && <span className="err">{error}</span>}
      </p>
    </div>
  );
}

/** the unique public username (the /profile/<username> slug + @-mention) */
export function Username({ userId }: { userId: string }) {
  const configured = gameServerConfigured();
  const [value, setValue] = useState('');
  const [current, setCurrent] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'saving' | 'ok' | 'error'>('idle');
  const [error, setError] = useState('');
  const check = useUsernameCheck(value, current ?? undefined);

  useEffect(() => {
    if (!configured) return;
    let alive = true;
    fetchProfile(userId)
      .then((p) => {
        if (!alive) return;
        setCurrent(p.username);
        if (p.username) setValue(p.username);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [userId, configured]);

  const dirty = check.normalized !== (current ?? '');
  const canSave = dirty && check.ok && status !== 'saving';

  const save = (): void => {
    if (!canSave) return;
    setStatus('saving');
    setError('');
    updateUsername(check.normalized)
      .then((r) => {
        setCurrent(r.username);
        setValue(r.username);
        setStatus('ok');
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setStatus('error');
      });
  };

  return (
    <div className="ds-panelbox">
      <label className="ds-field">
        <span className="cap">Username</span>
        <div className="ds-field-row">
          <div className="grow">
            <UsernameInput value={value} onChange={setValue} hintId="ds-profile-uname-hint" status={check.status} />
          </div>
          <button
            className={`ds-btn primary${status === 'saving' ? ' busy' : ''}`}
            disabled={!canSave}
            aria-busy={status === 'saving'}
            onClick={save}
          >
            Save
          </button>
        </div>
      </label>
      {/* live, so the checker's verdict and a failed save are heard, not just seen */}
      <p className="ds-hint" id="ds-profile-uname-hint" aria-live="polite">
        {current && (
          <>
            Your profile: <code>/profile/{current}</code>.{' '}
          </>
        )}
        {!configured && 'Editing needs the game server. '}
        {status === 'error' ? (
          <span className="err" role="alert">
            {error}
          </span>
        ) : status === 'ok' && !dirty ? (
          <span className="ok">Saved.</span>
        ) : (
          // the format rule comes from `useUsernameCheck` and ONLY from there —
          // it used to be spelled out a second time here, one edit away from
          // disagreeing with the rule the checker actually enforces
          (dirty || !current) && (
            <span className={`ds-form-hint ${usernameHintClass(check.status)}`}>{check.message}</span>
          )
        )}
      </p>
    </div>
  );
}
