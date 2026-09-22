import { useCallback, useEffect, useState } from 'react';
import {
  adminAddNote,
  adminClearUserRecords,
  adminClearUsername,
  adminDeleteNote,
  adminDeleteRecord,
  adminDeleteUser,
  adminFetchUser,
  adminGrantSupporter,
  adminLiftSuspension,
  adminRefundPayment,
  adminRenameUser,
  adminRevokeSupporter,
  adminSuspendUser,
  type AdminUserDetail,
} from '../net/api';
import { REPORT_LABELS, type ReportReason } from '../report';
import { SEASONS } from '../seasons';
import { STANDING_MAX, tierOf, lockRemaining } from '../standing';
import { adminFail } from './adminCopy';
import { StandingEditor } from './AdminStanding';
import { AccountName, CopyId, When, confirmed, downloadCsv } from './adminBits';
import type { WatchReplay } from './AdminReports';

/**
 * ONE ACCOUNT, EVERYTHING ABOUT IT.
 *
 * The console knew all of this already and kept it in four places that did not know about
 * each other: the Live table had a name, the report queue had counts, the standing editor had
 * the ledger, the user search had the membership. Deciding what to do about somebody meant
 * opening all four and holding the answer in your head — and three of the four had no way to
 * reach the fourth, so the usual move was to copy a uuid between tabs.
 *
 * Now every place a name appears opens this, and every action that can be taken about a
 * person is on it. The panel is deliberately READ-HEAVY at the top and action-light below:
 * the mistake this replaces is a console where the buttons are easy to find and the context
 * that decides which one to press is not.
 *
 * ⚠️ AN ACCOUNT WITH NO PROFILE ROW STILL OPENS. `known: false` is a real state, not an
 * error — see `AccountName` in `adminBits.tsx` — and it is exactly the state somebody is
 * looking at when they come here from a session that said it was signed in.
 */
const GAME_LABEL: Record<string, string> = Object.fromEntries(SEASONS.map((s) => [s.key, s.name]));

export function AdminUser({
  userId,
  onClose,
  onWatchReplay,
}: {
  userId: string;
  onClose: () => void;
  onWatchReplay?: WatchReplay;
}) {
  const [u, setU] = useState<AdminUserDetail | null>(null);
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [rename, setRename] = useState('');
  const [months, setMonths] = useState('1');
  const [note, setNote] = useState('');
  const [showStanding, setShowStanding] = useState(false);
  const [susDays, setSusDays] = useState('7');

  const load = useCallback(async (): Promise<void> => {
    const d = await adminFetchUser(userId);
    setErr(d === null);
    if (d) {
      setU(d);
      setRename(d.handle ?? '');
    }
  }, [userId]);

  useEffect(() => {
    setU(null);
    setStatus(null);
    setShowStanding(false);
    void load();
  }, [load]);

  if (err && !u) {
    return (
      <div className="adm-user">
        <div className="ds-empty">
          <div className="big">Couldn’t load the account</div>
          The game server is unreachable, or this account isn’t an admin on it.
        </div>
      </div>
    );
  }
  if (!u) return <div className="ds-loading">Loading account…</div>;

  const name = u.handle?.trim() || u.username || userId;
  // `suspension` is absent on an older server (one Fly app serves every client version), which
  // is "we were not told", not "not suspended" — but both render the same, and the panel must
  // not assert a state it was not sent.
  const suspendedUntil = u.suspension?.until ?? null;
  const standing = u.standing?.score ?? STANDING_MAX;
  const tier = tierOf(standing);
  const lockedUntil = u.standing?.restrictedUntil ?? null;
  const locked = lockedUntil !== null && lockedUntil > Date.now();

  /** run one action, then re-read. Every mutation here changes something ELSE on the panel
   *  — a grant moves the membership line, a pardon moves the standing tile — so a targeted
   *  optimistic patch would leave two of five places disagreeing. One re-read is honest. */
  const act = async (fn: () => Promise<boolean>, ok: string, fail: string): Promise<void> => {
    setBusy(true);
    const done = await fn();
    setBusy(false);
    setStatus(done ? ok : adminFail(fail));
    if (done) await load();
  };

  const doRename = (): void => {
    const next = rename.trim();
    if (next === (u.handle ?? '')) return;
    if (next.length < 2 || next.length > 24) {
      setStatus('A display name is 2–24 characters.');
      return;
    }
    if (!confirmed('Rename', `“${u.handle ?? userId}” to “${next}”`, 'Their old name is kept in the audit log.')) return;
    void act(async () => (await adminRenameUser(userId, next)) !== null, `Renamed to “${next}”.`, 'rename the player');
  };

  const doGrant = (): void => {
    const n = Math.floor(Number(months));
    if (!Number.isFinite(n) || n < 1 || n > 60) {
      setStatus('Months must be 1–60.');
      return;
    }
    const why = window.prompt(`Give ${name} ${n} month(s) of supporter. Reason?`, '');
    if (why === null) return;
    void act(
      async () => (await adminGrantSupporter(userId, n, why)) !== null,
      `Granted ${n} month${n === 1 ? '' : 's'}.`,
      'grant the membership',
    );
  };

  const doRevoke = (): void => {
    const why = window.prompt(`Revoke ${name}’s supporter membership. Reason?`, 'chargeback');
    if (why === null) return;
    void act(
      async () => (await adminRevokeSupporter(userId, why)) !== null,
      'Membership ended.',
      'revoke the membership',
    );
  };

  const doClearRecords = (): void => {
    if (
      !confirmed(
        'Delete every record run by',
        name,
        'Every mode and drivetrain, plus their replays. For a confirmed cheater. This cannot be undone.',
      )
    )
      return;
    void act(
      async () => (await adminClearUserRecords(userId)) !== null,
      'Record runs cleared.',
      'clear the runs',
    );
  };

  /**
   * SUSPEND. The reason is asked for and is NOT optional, because it is the sentence the
   * player reads at the door — a refusal with nothing after it generates an appeal that has
   * to be answered by looking the account up by hand, which is the work this panel exists to
   * remove. Anything a moderator does not want them to read goes in a note instead, and the
   * prompt says so.
   */
  const doSuspend = (): void => {
    const d = Math.floor(Number(susDays));
    if (!Number.isFinite(d) || d < 1 || d > 3650) {
      setStatus('Days must be 1–3650. Use a long one for a permanent ban.');
      return;
    }
    const why = window.prompt(
      `Suspend ${name} from online play for ${d} day${d === 1 ? '' : 's'}.\n\n` +
        'This reason is shown to them at the door. Put anything private in a note instead.',
      '',
    );
    if (why === null) return;
    if (!why.trim()) {
      setStatus('Give a reason. The player is shown it.');
      return;
    }
    void act(
      async () => (await adminSuspendUser(userId, d, why.trim())) !== null,
      `Suspended for ${d} day${d === 1 ? '' : 's'}.`,
      'suspend the account',
    );
  };

  const doLift = (): void => {
    if (!confirmed('Lift the suspension on', name, 'They can join rooms and queue ranked again immediately.')) return;
    void act(async () => (await adminLiftSuspension(userId)) !== null, 'Suspension lifted.', 'lift the suspension');
  };

  const doClearUsername = (): void => {
    if (!u.username) return;
    if (
      !confirmed(
        'Take the username @' + u.username + ' from',
        name,
        'They keep the account and are asked to claim a new one, which is checked the same way the first was. The old name is kept in the audit log.',
      )
    )
      return;
    void act(
      async () => (await adminClearUsername(userId)) !== null,
      'Username cleared. They claim a new one on their next load.',
      'clear the username',
    );
  };

  /**
   * DELETE. TERMINAL, so the guard is a TYPED confirmation rather than another OK button:
   * every other destructive control here is one click behind a `confirm`, and a control that
   * removes an account with its records, matches and reports should not be reachable by the
   * same reflex. The audit row survives the account — `admin_audit` has no foreign keys for
   * exactly this.
   */
  const doDelete = (): void => {
    const expect = u.username ?? userId;
    const typed = window.prompt(
      `Delete ${name} and everything they own: records, matches, reports, replays, membership.\n\n` +
        'This cannot be undone. The audit log keeps the record of it.\n\n' +
        `Type ${expect} to confirm.`,
      '',
    );
    if (typed === null) return;
    if (typed.trim().replace(/^@/, '') !== expect) {
      setStatus('That didn’t match, so nothing was deleted.');
      return;
    }
    const why = window.prompt('Why is this account being deleted?', '') ?? '';
    void act(
      async () => (await adminDeleteUser(userId, why))?.ok === true,
      'Account deleted.',
      'delete the account',
    );
  };

  const addNote = (): void => {
    const text = note.trim();
    if (!text) return;
    void act(async () => (await adminAddNote(userId, text)) !== null, 'Note saved.', 'save the note').then(
      () => setNote(''),
    );
  };

  return (
    <div className="adm-user">
      <div className="adm-user-h">
        <div className="adm-user-id">
          <h3 className="adm-user-name">{name}</h3>
          <div className="adm-user-sub">
            {u.username ? (
              <span className="ds-muted">@{u.username}</span>
            ) : (
              <span className="adm-nouser">no username yet</span>
            )}
            {u.role && <span className={`adm-pill role ${u.role}`}>{u.role}</span>}
            {u.supporter && <span className="adm-pill">supporter</span>}
            {suspendedUntil !== null && <span className="adm-pill queued">suspended</span>}
            {!u.known && (
              <span className="adm-pill standing" title="No profiles row exists for this account id">
                no profile row
              </span>
            )}
            <code className="adm-guest-id">{userId}</code>
            <CopyId id={userId} label="account id" />
          </div>
        </div>
        <button className="ds-btn ghost small" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="adm-stats small">
        <Tile label="Standing" value={`${standing}`} sub={tier.name} tone={tier.key === 'good' ? '' : 'bad'} />
        <Tile
          label="Reports"
          value={`${u.reportsAgainst.open}`}
          sub={`${u.reportsAgainst.total} total · ${u.reportsAgainst.reporters} reporters`}
          tone={u.reportsAgainst.open > 0 ? 'bad' : ''}
        />
        <Tile
          label="Filed"
          value={`${u.reportsFiled.total + u.scoreReportsFiled.total}`}
          sub={`${u.reportsFiled.rejected + u.scoreReportsFiled.rejected} rejected`}
          tone={u.reportsFiled.rejected + u.scoreReportsFiled.rejected > 2 ? 'bad' : ''}
        />
        <Tile label="Records" value={`${u.records.length}`} sub="on the boards" />
        <Tile label="Matches" value={`${u.recentMatches.length}`} sub="most recent" />
      </div>

      {/* THE SUSPENSION LINE GOES ABOVE THE RANKED LOCK, because they are different
          punishments and the bigger one has to be read first: a ranked lock is the automatic
          standing penalty healing on its own timer, a suspension is a moderator keeping this
          account out of every room. Somebody who reads only the first line must not come away
          thinking the account can still play. */}
      {suspendedUntil !== null && (
        <p className="adm-lockline">
          Suspended from online play · {suspensionLeft(suspendedUntil)} ·{' '}
          {u.suspension?.reason ? `“${u.suspension.reason}”` : 'no reason recorded'}
        </p>
      )}
      {locked && (
        <p className="adm-lockline">
          Ranked is locked for this account · {lockRemaining(lockedUntil as number, Date.now())}
        </p>
      )}

      <dl className="adm-facts">
        <Fact k="Joined" v={<When at={u.createdAt} />} />
        <Fact
          k="Membership"
          v={
            u.supporter ? (
              <>
                until {u.supporterUntil ? new Date(u.supporterUntil).toLocaleDateString() : '—'}
                {u.autoRenews ? ' · auto-renews' : ' · manual claims only'}
              </>
            ) : (
              <span className="ds-muted">none{u.autoRenews ? ' · Ko-fi linked (lapsed)' : ''}</span>
            )
          }
        />
        <Fact
          k="Terms"
          v={
            u.termsAcceptedAt ? (
              <>
                v{u.termsVersion ?? '?'} · <When at={u.termsAcceptedAt} />
              </>
            ) : (
              <span className="ds-muted">never accepted</span>
            )
          }
        />
        <Fact k="Replays" v={u.replaysPublic ? 'public' : <span className="ds-muted">private (default)</span>} />
      </dl>

      {/* ACTIONS. Rename and membership were on the search row and nowhere else, so they
          were unreachable from the report queue — the one place you are actually looking at
          somebody's behaviour when you decide to take a name off them. */}
      <h4 className="adm-h3">Actions</h4>
      <div className="adm-actions">
        <label className="admin-field">
          <span>Display name</span>
          <input type="text" maxLength={24} value={rename} onChange={(e) => setRename(e.target.value)} />
        </label>
        <button className="ds-btn ghost small" disabled={busy || rename.trim() === (u.handle ?? '')} onClick={doRename}>
          Rename
        </button>
        <label className="admin-field">
          <span>Supporter</span>
          <input
            type="number"
            min={1}
            max={60}
            className="admin-months"
            aria-label={`Months to grant ${name}`}
            value={months}
            onChange={(e) => setMonths(e.target.value)}
          />
        </label>
        <button className="ds-btn ghost small" disabled={busy} onClick={doGrant}>
          Grant
        </button>
        <button className="ds-btn ghost small" disabled={busy || !u.supporter} onClick={doRevoke}>
          Revoke
        </button>
        <button
          className={showStanding ? 'ds-btn small primary' : 'ds-btn ghost small'}
          onClick={() => setShowStanding(!showStanding)}
        >
          Standing
        </button>
        <button className="ds-btn danger small" disabled={busy || u.records.length === 0} onClick={doClearRecords}>
          Clear all records
        </button>
      </div>

      {/* NAME POLICY AND ENFORCEMENT, one row below the everyday actions. Rename and Grant are
          things a moderator does most days; these three end with somebody not being able to
          play, so they are not mixed in with them. */}
      <div className="adm-actions">
        <button className="ds-btn ghost small" disabled={busy || !u.username} onClick={doClearUsername}>
          {u.username ? `Clear @${u.username}` : 'No username to clear'}
        </button>
        {suspendedUntil === null ? (
          <>
            <label className="admin-field">
              <span>Suspend for</span>
              <input
                type="number"
                min={1}
                max={3650}
                className="admin-months"
                aria-label={`Days to suspend ${name}`}
                value={susDays}
                onChange={(e) => setSusDays(e.target.value)}
              />
              <span>days</span>
            </label>
            <button className="ds-btn danger small" disabled={busy} onClick={doSuspend}>
              Suspend
            </button>
          </>
        ) : (
          <button className="ds-btn small primary" disabled={busy} onClick={doLift}>
            Lift suspension
          </button>
        )}
        <button className="ds-btn danger small" disabled={busy || !u.known} onClick={doDelete}>
          Delete account
        </button>
      </div>
      <p className="ds-hint">
        A suspension blocks every online room and the ranked queue, on every region, and ends by
        itself on the day it names. Free drive and practice keep working. The reason is shown to
        the player; anything private belongs in a note below.
      </p>
      {status && <p className="ds-hint">{status}</p>}

      {showStanding && <StandingEditor userId={userId} handleHint={u.handle ?? undefined} />}

      {/* NOTES. Not a punishment and never shown to the player — which is exactly why the
          standing ledger could not hold them (0036: the ledger is read BACK to the player).
          "Warned in Discord", "team says this is a shared laptop", "third alt of X": the
          things that otherwise live in one moderator's head and leave when they do. */}
      <h4 className="adm-h3">
        Notes <span className="ds-muted">· private to staff</span>
      </h4>
      <div className="adm-noteadd">
        <input
          type="text"
          maxLength={1000}
          value={note}
          placeholder="What the next moderator needs to know"
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addNote()}
        />
        <button className="ds-btn small" disabled={busy || !note.trim()} onClick={addNote}>
          Add note
        </button>
      </div>
      {u.notes.length === 0 ? (
        <p className="ds-hint">No notes on this account.</p>
      ) : (
        <ul className="adm-notes">
          {u.notes.map((n) => (
            <li key={n.id}>
              <span className="adm-note-body">{n.note}</span>
              <span className="ds-muted">
                {n.adminId.slice(0, 8)} · <When at={n.at} />
              </span>
              <button
                className="ds-btn ghost small"
                disabled={busy}
                onClick={() => {
                  if (!confirmed('Delete this note on', name, 'The deletion itself is audited.')) return;
                  void act(
                    async () => (await adminDeleteNote(userId, n.id))?.ok === true,
                    'Note deleted.',
                    'delete the note',
                  );
                }}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* ⚠️ THE ROWS BEHIND THE TWO REPORT TILES. The panel printed "3 open · 5 total · 3
          reporters" and "14 filed · 9 rejected" and stopped: both numbers raise a question
          neither can answer. Three reports from three people in one evening and three across a
          season are the same tile; nine rejected claims spread over a year and nine aimed at
          one opponent are the same tile. The rows were always in `player_reports` — nothing
          read them from this direction. */}
      {(u.reportsAgainstList?.length ?? 0) > 0 && (
        <>
          <h4 className="adm-h3">
            Reports against them <span className="ds-muted">· {u.reportsAgainst.open} still open</span>
          </h4>
          <div className="adm-report-list">
            {(u.reportsAgainstList ?? []).map((r) => (
              <div className="adm-report-item" key={r.id}>
                <span className="adm-pill">{REPORT_LABELS[r.reason as ReportReason] ?? r.reason}</span>
                <span className="adm-report-by ds-muted">
                  by {r.reporterUsername ? `@${r.reporterUsername}` : r.reporterHandle} ·{' '}
                  <When at={r.createdAt} />
                  {r.roomCode && ` · room ${r.roomCode}`}
                  {r.status !== 'open' && ` · ${r.status}`}
                </span>
                {r.detail && <p className="adm-report-detail">{r.detail}</p>}
              </div>
            ))}
          </div>
        </>
      )}

      {(u.reportsFiledList?.length ?? 0) > 0 && (
        <>
          <h4 className="adm-h3">
            Reports they filed{' '}
            <span className="ds-muted">· {u.reportsFiled.rejected} dismissed</span>
          </h4>
          <div className="adm-report-list">
            {(u.reportsFiledList ?? []).map((r) => (
              <div className="adm-report-item" key={r.id}>
                <span className="adm-pill">{REPORT_LABELS[r.reason as ReportReason] ?? r.reason}</span>
                <span className="adm-report-by ds-muted">
                  {/* the SUBJECT is the useful name here — the filer is the open account */}
                  against{' '}
                  <AccountName
                    userId={r.subjectId}
                    handle={r.subjectHandle}
                    username={r.subjectUsername}
                    known={r.subjectHandle !== null}
                  />{' '}
                  · <When at={r.createdAt} />
                  {r.roomCode && ` · room ${r.roomCode}`}
                  {r.status !== 'open' && ` · ${r.status}`}
                </span>
                {r.detail && <p className="adm-report-detail">{r.detail}</p>}
              </div>
            ))}
          </div>
        </>
      )}

      <h4 className="adm-h3">
        Recent matches
        {u.recentMatches.length > 0 && (
          <button
            className="ds-btn ghost small adm-h3-act"
            onClick={() =>
              downloadCsv(
                `matches-${u.username ?? userId}.csv`,
                ['matchId', 'game', 'mode', 'ranked', 'score', 'won', 'at', 'replayId'],
                u.recentMatches.map((m) => [
                  m.matchId,
                  m.game,
                  m.mode,
                  m.ranked ? 'ranked' : 'custom',
                  m.score,
                  m.won === null ? '' : m.won ? 'won' : 'lost',
                  m.createdAt,
                  m.replayId ?? '',
                ]),
              )
            }
          >
            Export CSV
          </button>
        )}
      </h4>
      {u.recentMatches.length === 0 ? (
        <p className="ds-hint">No matches on record.</p>
      ) : (
        <div className="adm-report-list">
          {u.recentMatches.map((m) => (
            <div className="adm-report-item row" key={m.matchId}>
              <span className="ds-muted">
                {GAME_LABEL[m.game] ?? m.game} · {m.ranked ? 'Ranked' : 'Custom'} {m.mode} · {m.score} pts ·{' '}
                {m.won === null ? '—' : m.won ? 'won' : 'lost'} · <When at={m.createdAt} />
              </span>
              {m.replayId && onWatchReplay ? (
                <button className="ds-btn small" onClick={() => onWatchReplay(m.replayId as string, m.matchId)}>
                  Watch replay
                </button>
              ) : (
                <span className="ds-muted" title="This match saved no replay">
                  no replay
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <h4 className="adm-h3">Record runs</h4>
      {u.records.length === 0 ? (
        <p className="ds-hint">No leaderboard runs.</p>
      ) : (
        <div className="adm-report-list">
          {u.records.map((r) => (
            <div className="adm-report-item row" key={r.recordId}>
              <span className="ds-muted">
                {GAME_LABEL[r.game] ?? r.game} · {r.mode} · {r.drivetrain} · {r.score} pts · <When at={r.createdAt} />
              </span>
              <span className="adm-rowacts">
                {r.replayId && onWatchReplay && (
                  <button className="ds-btn ghost small" onClick={() => onWatchReplay(r.replayId as string)}>
                    Watch
                  </button>
                )}
                <button
                  className="ds-btn danger small"
                  disabled={busy}
                  onClick={() => {
                    if (
                      !confirmed(
                        'Delete the',
                        `${r.score}-pt ${r.drivetrain} run by ${name}`,
                        'The run and its replay go. This cannot be undone.',
                      )
                    )
                      return;
                    void act(() => adminDeleteRecord(r.recordId), 'Run deleted.', 'delete the run');
                  }}
                >
                  Delete
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {u.grants.length > 0 && (
        <>
          <h4 className="adm-h3">Membership history</h4>
          <ul className="adm-notes">
            {u.grants.map((g, i) => (
              <li key={i}>
                <span className="adm-note-body">
                  <b>{g.source}</b>
                  {g.months ? ` +${g.months}mo` : ''}
                  {g.note ? ` · ${g.note}` : ''}
                </span>
                <span className="ds-muted">
                  <When at={g.createdAt} />
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* ⚠️ PAYMENTS, NOT GRANTS — and that is why the refund route had no caller. A GRANT is
          months; a PAYMENT is a transaction, and `/api/admin/supporter/refund` is keyed by the
          second. The membership history above showed only the first, so the id the route needs
          appeared nowhere in the console and a chargeback could not be recorded from it at all.
          Flagging a payment deliberately does NOT end the membership: it may cover other
          payments, so revoking is a second decision and Revoke above is where it lives. */}
      {(u.payments?.length ?? 0) > 0 && (
        <>
          <h4 className="adm-h3">Payments claimed</h4>
          <ul className="adm-notes">
            {(u.payments ?? []).map((p, i) => (
              <li key={p.transactionId ?? i}>
                <span className="adm-note-body">
                  <b>
                    {p.amount ?? '—'} {p.currency ?? ''}
                  </b>{' '}
                  · {p.kind}
                  {p.isSubscription ? ' · subscription' : ''}
                  {p.transactionId ? (
                    <>
                      {' · '}
                      <code className="adm-guest-id">{p.transactionId}</code>
                      <CopyId id={p.transactionId} label="transaction id" />
                    </>
                  ) : (
                    <span className="ds-muted"> · no transaction id</span>
                  )}
                  {p.refundedAt && <span className="adm-pill queued">charged back</span>}
                </span>
                <span className="ds-muted">
                  <When at={p.claimedAt} />
                </span>
                {p.transactionId && !p.refundedAt && (
                  <button
                    className="ds-btn ghost small"
                    disabled={busy}
                    onClick={() => {
                      if (
                        !confirmed(
                          'Flag the payment',
                          `${p.amount ?? ''} ${p.currency ?? ''} (${p.transactionId})`,
                          'It is marked charged back. The membership is NOT ended. Use Revoke above for that.',
                        )
                      )
                        return;
                      void act(
                        async () => (await adminRefundPayment(p.transactionId as string))?.ok === true,
                        'Payment flagged as charged back.',
                        'flag the payment',
                      );
                    }}
                  >
                    Flag refunded
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {/* WHAT HAS BEEN DONE TO THIS ACCOUNT — the audit log, filtered to them. The Audit tab
          answers "what has this moderator done"; this answers the other direction, which is
          the one an appeal arrives as. */}
      <h4 className="adm-h3">Moderation history</h4>
      {u.audit.length === 0 ? (
        <p className="ds-hint">Nothing has been done to this account.</p>
      ) : (
        <ul className="adm-notes">
          {u.audit.map((a) => (
            <li key={a.id}>
              <span className="adm-note-body">
                <code>{a.action}</code>
                {a.note ? ` · ${a.note}` : ''}
                {Object.keys(a.detail).length > 0 && (
                  <span className="ds-muted"> · {JSON.stringify(a.detail)}</span>
                )}
              </span>
              <span className="ds-muted">
                {a.adminId.slice(0, 8)} · <When at={a.at} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * HOW LONG A SUSPENSION HAS LEFT, on the scale a suspension is actually set on.
 *
 * ⚠️ NOT `lockRemaining`. That one is the STANDING lock's formatter and its scale is minutes
 * and hours, because that is what a standing lock is — five minutes for a dodge, thirty for
 * leaving a match. A suspension is set in DAYS, so it rendered a one-week ban as "168 hours"
 * and would render the permanent one as "87600 hours". Two different punishments on two
 * different scales need two formatters; sharing one is how the wrong unit gets shipped.
 *
 * The exact end is in the `title`, because "6 days" is what you read a panel with and a date
 * is what you put in a reply to an appeal.
 */
function suspensionLeft(until: number): React.ReactNode {
  const ms = Math.max(0, until - Date.now());
  const hours = Math.ceil(ms / 3_600_000);
  const days = Math.round(ms / 86_400_000);
  const text =
    hours <= 48
      ? `${hours} hour${hours === 1 ? '' : 's'} left`
      : days < 400
        ? `${days} day${days === 1 ? '' : 's'} left`
        : 'effectively permanent';
  return <span title={new Date(until).toLocaleString()}>{text}</span>;
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className={`adm-stat${tone ? ` ${tone}` : ''}`} title={sub}>
      <b>{value}</b>
      <span>{label}</span>
      {sub && <i className="adm-stat-sub">{sub}</i>}
    </div>
  );
}

function Fact({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="adm-fact">
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}
