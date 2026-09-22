import { useEffect, useState } from 'react';
import {
  adminFetchReports,
  adminFetchReportedUser,
  adminFetchScoreReports,
  adminResolveScoreReport,
  adminSetReportStatus,
  type ScoreReport,
} from '../net/api';
import { REPORT_LABELS, type ReportedUser, type ReportReason } from '../report';
import { STANDING_COST, STANDING_MAX, tierOf } from '../standing';
import { StandingEditor } from './AdminStanding';
import { SEASONS } from '../seasons';
import { AccountName, When, ago, confirmed, downloadCsv } from './adminBits';

/**
 * The REPORT QUEUE — who has been reported, how often, for what, by how many people, and
 * (the part that makes it workable) their actual matches, one click from a replay.
 *
 * A report for cheating or throwing cannot be judged from its text. The moderator has to
 * watch the match. A queue that shows the complaint but makes them go and hunt for the
 * replay somewhere else is a queue that quietly stops being worked, so the drill-down loads
 * the reports AND the reported player's recent matches in one request and puts a WATCH
 * button on every one that has a replay.
 *
 * DISTINCT REPORTERS is shown next to the total on purpose. Four reports from four people
 * and four from one are completely different signals — one is a pattern, the other might be
 * a grudge — and a queue sorted only on volume rewards whoever clicks hardest.
 */
const GAME_LABEL: Record<string, string> = Object.fromEntries(SEASONS.map((s) => [s.key, s.name]));

/**
 * How a replay is opened from here.
 *
 * TWO IDS, and confusing them is what made every WATCH button in the misscore queue return a
 * 404: `replayId` is what `/api/replay/<id>` serves, `matchId` is the row that points at it,
 * and the misscore queue only ever had the second one. The match is still passed — as the
 * second argument — because a moderator watching a replay from a misscore claim needs to
 * correct THAT MATCH's score, and the viewer cannot work out which match a replay belongs to
 * from the replay alone.
 */
export type WatchReplay = (replayId: string, matchId?: string) => void;

export function AdminReports({
  onWatchReplay,
  onOpenUser,
}: {
  onWatchReplay?: WatchReplay;
  onOpenUser?: (userId: string) => void;
}) {
  const [users, setUsers] = useState<ReportedUser[] | null>(null);
  const [err, setErr] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  /** OPEN FIRST, because the queue is a queue. A moderator working it wants the rows with
   *  somebody waiting on them; the rest is history and is one click away. */
  const [onlyOpen, setOnlyOpen] = useState(true);

  const load = (): void => {
    void adminFetchReports().then((u) => {
      setErr(u === null);
      if (u) setUsers(u);
    });
  };
  useEffect(load, []);

  /**
   * TRIAGE UPDATES THE ROW IN PLACE rather than re-fetching the whole queue.
   *
   * It used to call `load()` on every verdict, which re-read every reported player on the
   * service to change one number on one row — and, because the list re-sorts on recency, the
   * row you had just judged moved under the cursor while the next one slid into its place.
   * Working a queue of six was six full queue reads and six chances to press Uphold on
   * somebody you had not looked at.
   */
  const applyTriage = (userId: string): void =>
    setUsers((cur) => (cur ? cur.map((x) => (x.userId === userId ? { ...x, open: 0 } : x)) : cur));

  const shown = (users ?? []).filter((u) => !onlyOpen || u.open > 0);

  return (
    <>
      <ScoreReportQueue onWatchReplay={onWatchReplay} onOpenUser={onOpenUser} />

      <h2 className="ds-h2">Moderation · reports</h2>
      <p className="ds-sub adm-sub">
        Players other players have reported, most recently reported first. Open one to read the
        reports and watch their recent matches. A cheating or throwing report is only judgeable
        from the replay.
      </p>

      <div className="adm-toolbar">
        <button
          className={onlyOpen ? 'ds-btn small primary' : 'ds-btn ghost small'}
          onClick={() => setOnlyOpen(true)}
        >
          Open only
        </button>
        <button
          className={onlyOpen ? 'ds-btn ghost small' : 'ds-btn small primary'}
          onClick={() => setOnlyOpen(false)}
        >
          Everything
        </button>
        <span className="adm-grow" />
        {/* disabled only while the FIRST load is in flight. It was `users.length === 0` too,
            which made Refresh dead in exactly the state you press it in: the queue is empty,
            somebody says they have just reported a player, and the one control that would
            fetch them is greyed out. */}
        <button className="ds-btn ghost small" disabled={!users} onClick={load}>
          Refresh
        </button>
        <button
          className="ds-btn ghost small"
          disabled={shown.length === 0}
          onClick={() =>
            downloadCsv(
              'reports.csv',
              ['userId', 'handle', 'username', 'open', 'total', 'reporters', 'standing', 'latest', 'reasons'],
              shown.map((u) => [
                u.userId, u.handle, u.username ?? '', u.open, u.total, u.reporters,
                u.standing ?? '', u.latest, u.reasons.map((r) => `${r.reason}x${r.n}`).join(' '),
              ]),
            )
          }
        >
          Export CSV
        </button>
      </div>

      {err && !users ? (
        <div className="ds-empty">
          <div className="big">Couldn’t load reports</div>
          The game server is unreachable, or this account isn’t an admin on it.
        </div>
      ) : !users ? (
        <div className="ds-loading">Loading reports…</div>
      ) : shown.length === 0 ? (
        <div className="ds-empty">
          <div className="big">{onlyOpen ? 'Queue is clear' : 'No reports'}</div>
          {onlyOpen && users.length > 0
            ? 'Nothing is waiting on a decision. Switch to Everything for the history.'
            : 'Nobody has been reported yet.'}
        </div>
      ) : (
        <div className="adm-reports">
          {shown.map((u) => (
            <ReportedRow
              key={u.userId}
              u={u}
              expanded={open === u.userId}
              onToggle={() => setOpen(open === u.userId ? null : u.userId)}
              onWatchReplay={onWatchReplay}
              onOpenUser={onOpenUser}
              onTriaged={() => applyTriage(u.userId)}
            />
          ))}
        </div>
      )}
    </>
  );
}

function ReportedRow({
  u,
  expanded,
  onToggle,
  onWatchReplay,
  onOpenUser,
  onTriaged,
}: {
  u: ReportedUser;
  expanded: boolean;
  onToggle: () => void;
  onWatchReplay?: WatchReplay;
  onOpenUser?: (userId: string) => void;
  onTriaged: () => void;
}) {
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof adminFetchReportedUser>>>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!expanded || detail) return;
    void adminFetchReportedUser(u.userId).then((d) => d && setDetail(d));
  }, [expanded, detail, u.userId]);

  const triage = async (status: 'reviewed' | 'dismissed'): Promise<void> => {
    if (
      status === 'reviewed' &&
      !confirmed(
        'Uphold the reports against',
        u.handle,
        `That costs ${STANDING_COST.reportUpheld} standing, locks them out of ranked, and takes ` +
          'rating. Each repeat costs more.',
      )
    )
      return;
    setBusy(true);
    await adminSetReportStatus(u.userId, status);
    setBusy(false);
    setDetail(null);
    onTriaged();
  };

  return (
    <div className={`adm-report ${expanded ? 'open' : ''}`}>
      <button className="adm-report-head" onClick={onToggle}>
        <span className="adm-report-who">
          <b>{u.handle}</b>
          {u.username && <span className="ds-muted"> @{u.username}</span>}
        </span>
        <span className="adm-report-counts">
          {/* OPEN is the number a moderator is working through; TOTAL is the history. Both,
              because a player with 1 open and 40 reviewed is a different problem. */}
          {u.open > 0 && <span className="adm-pill queued">{u.open} open</span>}
          <span className="adm-pill">{u.total} total</span>
          <span className="adm-pill">{u.reporters} reporter{u.reporters === 1 ? '' : 's'}</span>
          {/* STANDING is the corroborating half. Reports are what other players CLAIM; this
              is what the server itself watched them do — a full standing next to twelve
              reports reads very differently from a collapsed one. */}
          {typeof u.standing === 'number' && u.standing < STANDING_MAX && (
            <span className={`adm-pill standing${tierOf(u.standing).key === 'good' ? ' ok' : ''}`}>
              {tierOf(u.standing).name} {u.standing}
            </span>
          )}
        </span>
        <span className="adm-report-reasons ds-muted">
          {u.reasons.slice(0, 3).map((r) => `${REPORT_LABELS[r.reason as ReportReason] ?? r.reason} ×${r.n}`).join(' · ')}
        </span>
        <span className="adm-report-when ds-muted">{ago(u.latest)}</span>
        <span className="adm-report-caret">{expanded ? '▾' : '▸'}</span>
      </button>

      {expanded && (
        <div className="adm-report-body">
          {!detail ? (
            <div className="ds-loading">Loading…</div>
          ) : (
            <>
              <h4 className="adm-h3">Reports</h4>
              <div className="adm-report-list">
                {detail.reports.map((r) => (
                  <div className="adm-report-item" key={r.id}>
                    <span className="adm-pill">{REPORT_LABELS[r.reason] ?? r.reason}</span>
                    <span className="adm-report-by ds-muted">
                      by {r.reporterUsername ? `@${r.reporterUsername}` : r.reporterHandle} ·{' '}
                      <When at={r.createdAt} />
                      {r.roomCode && ` · room ${r.roomCode}`}
                      {r.status !== 'open' && ` · ${r.status}`}
                    </span>
                    {r.detail && <p className="sr-detail">{r.detail}</p>}
                  </div>
                ))}
              </div>

              {onOpenUser && (
                <div className="adm-toolbar">
                  {/* THE WAY OUT TO THE WHOLE ACCOUNT. The drill-down answers "what are they
                      accused of"; the questions it cannot — is this their first week, have
                      they filed forty reports of their own, has somebody already warned them
                      — live on the account, and there was no link to it from here. */}
                  <button className="ds-btn ghost small" onClick={() => onOpenUser(u.userId)}>
                    Open full account
                  </button>
                </div>
              )}

              {/* WHAT THE SERVER SAW, and the controls to overrule it, in one place.
                  This used to be a read-only list: a moderator could see that someone had
                  been charged for three abandons and had no way to say the room crashed. The
                  editor is the same component the Moderation tab's user search opens, so
                  there is one standing panel in the console rather than two that drift. */}
              <h4 className="adm-h3">What the server saw</h4>
              <StandingEditor userId={u.userId} handleHint={u.handle} />

              <h4 className="adm-h3">Their recent matches</h4>
              {detail.matches.length === 0 ? (
                <p className="ds-hint">No matches on record for this player.</p>
              ) : (
                <div className="adm-report-list">
                  {detail.matches.map((m) => (
                    <div className="adm-report-item row" key={m.matchId}>
                      <span className="ds-muted">
                        {GAME_LABEL[m.game] ?? m.game} · {m.ranked ? 'Ranked' : 'Custom'} {m.mode} ·{' '}
                        {m.score} pts · {m.won === null ? '—' : m.won ? 'won' : 'lost'} ·{' '}
                        <When at={m.createdAt} />
                      </span>
                      {m.replayId && onWatchReplay ? (
                        <button
                          className="ds-btn small"
                          onClick={() => onWatchReplay(m.replayId as string, m.matchId)}
                        >
                          Watch replay
                        </button>
                      ) : (
                        <span className="ds-muted" title="This match saved no replay">no replay</span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="sr-actions">
                {/* Triage marks the PLAYER, not each complaint — that is how the queue is
                    actually worked: you watch their matches and then make one call. */}
                <button className="ds-btn ghost small" disabled={busy || u.open === 0} onClick={() => void triage('dismissed')}>
                  Dismiss {u.open > 0 ? `(${u.open})` : ''}
                </button>
                <button className="ds-btn small" disabled={busy || u.open === 0} onClick={() => void triage('reviewed')}>
                  Uphold {u.open > 0 ? `(${u.open})` : ''}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The MISSCORE queue — claims about a RESULT rather than about a person.
 *
 * Its own section because it is answered differently. A player report is judged by watching
 * someone drive; a misscore is judged by opening the replay and checking the arithmetic, and
 * the verdict is about the SCORE, not about the reporter. The reporter only enters it when
 * the claim turns out to be empty — which is what SMITE is for, and why every row shows how
 * many claims that person has filed and how many were rejected before offering it.
 *
 * UPHOLD costs nobody anything. There is no automatic re-score behind it: a result that has
 * been written, rated and published cannot be quietly rewritten from a moderation panel, and
 * pretending otherwise would be worse than leaving it. What upholding does is mark the claim
 * as real, which is what stops the filer's rejected-count from growing and is the record that
 * the sim got something wrong.
 */
function ScoreReportQueue({
  onWatchReplay,
  onOpenUser,
}: {
  onWatchReplay?: WatchReplay;
  onOpenUser?: (userId: string) => void;
}) {
  const [rows, setRows] = useState<ScoreReport[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = (): void => {
    void adminFetchScoreReports('open').then((r) => setRows(r ?? []));
  };
  useEffect(load, []);
  if (!rows || rows.length === 0) return null;

  const resolve = (id: string, verdict: 'upheld' | 'rejected', smite: number): void => {
    if (
      smite > 0 &&
      !confirmed(
        'Reject this claim and take',
        `${smite} standing from the player who filed it`,
        'Only for a claim made in bad faith.',
      )
    )
      return;
    setBusy(id);
    void adminResolveScoreReport(id, verdict, smite).then(() => {
      setBusy(null);
      load();
    });
  };

  return (
    <>
      <h2 className="ds-h2">Moderation · misscores</h2>
      <p className="ds-sub adm-sub">
        Claims that a match scored wrong. Open the replay and check it: UPHELD records that the
        sim got it wrong, REJECTED closes it. Smite only a claim that was made in bad faith.
        The count beside each filer is how many of theirs have been rejected before.
      </p>
      <div className="sr-list">
        {rows.map((r) => (
          <div key={r.id} className="sr-row">
            <div className="sr-head">
              <AccountName
                userId={r.reporterId}
                handle={r.reporterHandle}
                username={r.reporterUsername}
                known
                onOpen={onOpenUser}
              />
              <span className="adm-pill">{GAME_LABEL[r.game] ?? r.game}</span>
              {r.reporterRejected > 0 && (
                <span className="adm-pill standing">
                  {r.reporterRejected} of {r.reporterFiled} rejected
                </span>
              )}
              <span className="ds-muted">{new Date(r.createdAt).toLocaleString()}</span>
            </div>
            <p className="adm-report-detail">{r.detail}</p>
            <div className="adm-report-actions">
              {/* THE REPLAY, not the match. This button passed `matchId` to a route that
                  serves replays by `replays.id`, so it 404'd on every single claim — the one
                  thing a misscore queue exists to let a moderator do. A claim whose match
                  never finished writing, or whose replay was purged with an archived season,
                  genuinely has nothing to open, and says so instead of offering a dead button. */}
              {onWatchReplay &&
                (r.replayId ? (
                  <button className="ds-btn ghost" onClick={() => onWatchReplay(r.replayId!, r.matchId ?? undefined)}>
                    WATCH
                  </button>
                ) : (
                  <span className="ds-muted" title={r.matchId ? 'This match saved no replay' : 'This claim points at no stored match'}>
                    no replay
                  </span>
                ))}
              <button
                className="ds-btn ghost"
                disabled={busy === r.id}
                onClick={() => resolve(r.id, 'upheld', 0)}
              >
                UPHELD
              </button>
              <button
                className="ds-btn ghost"
                disabled={busy === r.id}
                onClick={() => resolve(r.id, 'rejected', 0)}
              >
                REJECT
              </button>
              {/* the smite, sized by the moderator. Three rungs rather than a free number:
                  "wrong", "wrong again", and "using the queue as a weapon" are the three
                  judgements actually being made, and a text box invites a fourth that is just
                  a mood. */}
              {[25, 50, 100].map((n) => (
                <button
                  key={n}
                  className="ds-btn danger"
                  disabled={busy === r.id}
                  onClick={() => resolve(r.id, 'rejected', n)}
                  title={`Reject and take ${n} standing points off ${r.reporterUsername ?? r.reporterHandle}`}
                >
                  SMITE −{n}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
