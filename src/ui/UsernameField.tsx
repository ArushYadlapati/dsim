import { useEffect, useRef, useState } from 'react';
import { checkUsername, USERNAME_RE } from '../net/api';

export type UsernameStatus =
  | 'empty'
  | 'invalid' // wrong format
  | 'blocked' // format ok but disallowed by content moderation
  | 'checking' // format ok, asking the server
  | 'available'
  | 'taken'
  | 'error'; // couldn't reach the server

export interface UsernameCheck {
  /** trimmed + lowercased candidate */
  normalized: string;
  status: UsernameStatus;
  /** true only when the server confirmed it's free (safe to submit) */
  ok: boolean;
  message: string;
}

/**
 * Live-validates a username as the user types: local FORMAT check (4–20 lowercase
 * letters/digits) is instant, then a debounced server AVAILABILITY check. Shared
 * by sign-up, the blocking username gate, and the account editor so all three
 * agree on the rules. `ownValue` (the user's current username) is treated as
 * "available" — editing back to your own name isn't a conflict.
 */
export function useUsernameCheck(raw: string, ownValue?: string): UsernameCheck {
  const normalized = raw.trim().toLowerCase();
  const [status, setStatus] = useState<UsernameStatus>('empty');
  const seq = useRef(0);

  useEffect(() => {
    if (normalized.length === 0) {
      setStatus('empty');
      return;
    }
    if (ownValue && normalized === ownValue) {
      setStatus('available');
      return;
    }
    if (!USERNAME_RE.test(normalized)) {
      setStatus('invalid');
      return;
    }
    setStatus('checking');
    const mySeq = ++seq.current;
    const t = setTimeout(() => {
      checkUsername(normalized)
        .then((r) => {
          if (mySeq !== seq.current) return; // a newer keystroke supersedes this
          setStatus(
            r.reason === 'inappropriate' ? 'blocked' : !r.valid ? 'invalid' : r.available ? 'available' : 'taken',
          );
        })
        .catch(() => {
          if (mySeq === seq.current) setStatus('error');
        });
    }, 400);
    return () => clearTimeout(t);
  }, [normalized, ownValue]);

  const message =
    status === 'empty'
      ? 'Lowercase letters and numbers, 4–20 characters.'
      : status === 'invalid'
        ? 'Only lowercase letters and numbers (4–20).'
        : status === 'blocked'
          ? 'That username isn’t allowed. Pick another.'
          : status === 'checking'
            ? 'Checking…'
            : status === 'available'
              ? 'Available ✓'
              : status === 'taken'
                ? 'That username is taken.'
                : 'Couldn’t check right now. Try again.';

  return { normalized, status, ok: status === 'available', message };
}

/** the verdicts that mean "this name will not do" — the input's `aria-invalid` and the
 *  hint's danger colour both read this, so the two cannot disagree. */
export function usernameBad(status: UsernameStatus): boolean {
  return status === 'invalid' || status === 'blocked' || status === 'taken' || status === 'error';
}

/** the status hint's verdict class, `.ds-form-hint.ok` / `.err` (the colours live in
 *  shell.css, not in a JS switch over tokens). Empty while there is no verdict. */
export function usernameHintClass(status: UsernameStatus): '' | 'ok' | 'err' {
  if (status === 'available') return 'ok';
  if (usernameBad(status)) return 'err';
  return '';
}

/** a bare username `<input>` with a live @-prefix; the parent owns validation via
 * `useUsernameCheck` and renders the hint. Coerces to lowercase-alnum as typed.
 *
 * `hintId` is the id of that hint, and `status` the checker's verdict: the input points
 * `aria-describedby` at the hint and turns `aria-invalid` on for a bad verdict, so a screen
 * reader hears "taken" instead of just finding the submit disabled (design review C11).
 * The hint itself carries `aria-live="polite"` at each call site. */
export function UsernameInput({
  value,
  onChange,
  autoFocus,
  placeholder = 'yourname',
  hintId,
  status,
}: {
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  placeholder?: string;
  hintId?: string;
  status?: UsernameStatus;
}) {
  return (
    <div className="ds-username-input">
      <span className="at">@</span>
      <input
        className="ds-input"
        type="text"
        maxLength={20}
        autoFocus={autoFocus}
        autoComplete="username"
        aria-describedby={hintId}
        aria-invalid={status ? usernameBad(status) : undefined}
        value={value}
        placeholder={placeholder}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''))}
      />
    </div>
  );
}
