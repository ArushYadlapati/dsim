import { Fragment, useEffect, useRef, useState } from 'react';
import type { HudSnapshot, EloResultRow } from '../game';
import { appChannel, lanActive } from '../net/env';
import { PTS_FOUL_MINOR, PTS_FOUL_MAJOR } from '../config';
import { ResultsAd } from './AdSlot';
import { ReportDialog } from './ReportDialog';
import { ScoreReportDialog } from './ScoreReportDialog';
import type { MatchResultInfo } from '../net/session';
import type { RecordRankInfo } from '../net/protocol';
import type { Replay, ReplayResult } from '../sim/replay';
import type { RobotSetup } from '../sim/spawn';
import { moduleFor } from '../games';
import { seasonFor } from '../seasons';
import type { Alliance, DrivetrainType, ScoreBreakdown } from '../types';

/**
 * THE RESULTS SCREEN — a full-screen broadcast takeover, built against the official FTC
 * scoring software's audience "Match Results" display: it replaces the whole viewport (not
 * a card on a scrim), splits into a RED half and a BLUE half each carrying its team rows and
 * a huge final total, with the category breakdown centred between them, a WINNER banner on
 * the winning side, and a ~3.2s lead-up animation (wipe → panels settle → rows cascade →
 * totals land → secondary info) before the quiet actions row appears.
 *
 * Split out of `GameView.tsx` so the live in-match HUD and the post-match screen stop
 * sharing one 1700-line file. `GameView` still owns `<Results>`'s call site and props —
 * nothing here changes that contract except one additive prop (`localRobotId`, needed to
 * mark "YOU" in a roster row; see the call site).
 *
 * ── THEMING: THIS SCREEN IS FIXED-DARK, LIKE THE FIELD CANVAS — DELIBERATELY ─────────────
 * A broadcast scoreboard does not go light-mode. The stage background (`--ds-stage-bg`, new
 * — see shell.css) and every piece of text painted directly on it (`--ds-on-field*`) are the
 * CANVAS-GROUND family: fixed, never re-valued in the dark block, exactly like the game field
 * itself. The two alliance halves stay the existing fixed-ink chip pair
 * (`--ds-{red,blue}-chip` / `-chip-ink`) — already non-inverting, so nothing here clashes.
 * The actions row keeps the ordinary THEMED `.overlay-buttons` (it is its own opaque surface
 * floating on top, the same relationship the in-match HUD already has with the fixed-dark
 * field behind it).
 */

const DRIVETRAIN_LABEL: Record<string, string> = {
  mecanum: 'Mecanum',
  xdrive: 'X-Drive',
  butterfly: 'Butterfly',
  tank: 'Tank',
  swerve: 'Swerve',
  // sentinel for a mixed-drivetrain duo run (overall board only, no dt-specific)
  overall: 'Mixed',
};
const prettyDrivetrain = (d: string): string => DRIVETRAIN_LABEL[d] ?? d;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** count an integer from `from` to `target` over `duration` ms once `active` flips true
 * (ease-out cubic). A reduced-motion viewer gets the target immediately rather than a
 * faster version of the same animation — capping duration alone would still be motion,
 * just shorter (see CLAUDE.md's gotcha). */
function useCountUp(target: number, active: boolean, duration = 900, from = 0): number {
  const [val, setVal] = useState(from);
  useEffect(() => {
    if (!active) {
      setVal(from);
      return;
    }
    if (prefersReducedMotion()) {
      setVal(target);
      return;
    }
    let raf = 0;
    let t0 = 0;
    const tick = (t: number): void => {
      if (!t0) t0 = t;
      const p = Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(from + (target - from) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, active, duration, from]);
  return active ? val : from;
}

/** a single breakdown VALUE, counting up on its own short beat once `run` flips true,
 * staggered by `index` — the "rows cascade in, each pair of values counting up" beat.
 * Capped stagger (10 rows) so a long BIOBUZZ breakdown doesn't stretch the phase. */
function RowVal({ value, run, index }: { value: number; run: boolean; index: number }) {
  const [go, setGo] = useState(false);
  useEffect(() => {
    if (!run) {
      setGo(false);
      return;
    }
    const id = window.setTimeout(() => setGo(true), Math.min(index, 10) * 55);
    return () => window.clearTimeout(id);
  }, [run, index]);
  const shown = useCountUp(value, go, 350);
  return <>{shown}</>;
}

/**
 * THE LEAD-UP SEQUENCE. Phases run once `revealed` flips true (the same instant the sim's
 * own `match_result` whoosh plays — see `GameController`'s settle-clock comment — so the
 * sound, the wipe and the saved score stay one moment, with no new audio hook needed here):
 *
 *   wipe (700ms)   — the two halves slam in from their edges; the title stings over the seam
 *   split (650ms)  — halves finish settling; team rows slide in from their own sides
 *   rows (900ms)   — the breakdown cascades top→bottom, each value counting up
 *   totals (950ms) — a beat of suspense, then the big totals count up and land with a punch;
 *                    the WINNER banner sweeps in on the winning side
 *   done           — ELO deltas / record callout / fouls detail / actions / ad fade in;
 *                    focus lands on the primary action
 *
 * `skip()` (click, Enter or Space) jumps straight to `done`. Reduced motion skips the whole
 * sequence and cross-fades directly to it — see the `prefersReducedMotion` branch.
 */
type Phase = 'wait' | 'wipe' | 'split' | 'rows' | 'totals' | 'done';
const PHASE_MS: Record<'wipe' | 'split' | 'rows' | 'totals', number> = {
  wipe: 700,
  split: 650,
  rows: 900,
  totals: 950,
};
const PHASE_ORDER: readonly Phase[] = ['wipe', 'split', 'rows', 'totals', 'done'];

function usePhase(revealed: boolean): { phase: Phase; skip: () => void } {
  const [phase, setPhase] = useState<Phase>('wait');
  const timers = useRef<number[]>([]);

  const clearTimers = (): void => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
  };

  useEffect(() => {
    clearTimers();
    if (!revealed) {
      setPhase('wait');
      return clearTimers;
    }
    if (prefersReducedMotion()) {
      setPhase('done');
      return clearTimers;
    }
    setPhase('wipe');
    let t = 0;
    for (let i = 1; i < PHASE_ORDER.length; i++) {
      t += PHASE_MS[PHASE_ORDER[i - 1] as keyof typeof PHASE_MS];
      const next = PHASE_ORDER[i];
      timers.current.push(window.setTimeout(() => setPhase(next), t));
    }
    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealed]);

  const skip = (): void => {
    clearTimers();
    setPhase((p) => (p === 'wait' ? p : 'done'));
  };

  // Enter / Space skip the sequence — Escape is left alone: it is already the app-wide
  // menu/exit key (GameController's global handler), and overloading it here would fight
  // that convention instead of extending it. A click anywhere on the stage also skips
  // (wired on the root element itself, not here).
  useEffect(() => {
    if (phase === 'wait' || phase === 'done') return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        skip();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  return { phase, skip };
}

/** one driver's roster row: name, "YOU" marker, drivetrain, and (ranked, once `done`) the
 * ELO delta. Built from the match's own recorded `RobotSetup`s (`Replay.setups`), not a
 * second roster the server sends separately — a replay already has to carry this to be
 * reproducible, so it is the one source both this screen and a later replay viewer agree on. */
interface RosterEntry {
  robotId: number;
  name: string;
  drivetrain: DrivetrainType;
  isLocal: boolean;
  elo: EloResultRow | null;
}

function rosterFor(
  setups: readonly RobotSetup[],
  alliance: Alliance,
  localRobotId: number | undefined,
  eloResults: EloResultRow[] | null,
): RosterEntry[] {
  return setups
    .filter((s) => s.alliance === alliance && !s.passive)
    .map((s) => ({
      robotId: s.id,
      name: s.spec.name || `Driver ${s.id}`,
      drivetrain: s.spec.drivetrain,
      isLocal: s.id === localRobotId,
      elo: eloResults?.find((r) => r.robotId === s.id) ?? null,
    }));
}

/** the small "Updating ELO…" line for a ranked match whose per-driver deltas have not
 * landed yet. Same 9s give-up as the old dedicated ELO block. */
function useEloPending(ranked: boolean, eloResults: EloResultRow[] | null): string | null {
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (!ranked || eloResults !== null) return;
    const id = window.setTimeout(() => setTimedOut(true), 9000);
    return () => window.clearTimeout(id);
  }, [ranked, eloResults]);
  if (!ranked || eloResults !== null) return null;
  // alpha builds never persist — the server sends no eloResult, so say so up front
  // instead of spinning on "Updating ELO…"
  if (appChannel() === 'alpha') return 'Not rated on this test build.';
  return timedOut ? 'No rating change this match.' : 'Updating ELO…';
}

function RosterList({ roster, showElo }: { roster: readonly RosterEntry[]; showElo: boolean }) {
  if (roster.length === 0) return null;
  return (
    <ul className="resx-roster">
      {roster.map((p, i) => (
        <li key={p.robotId} className="resx-roster-row" style={{ animationDelay: `${i * 90}ms` }}>
          <span className="resx-roster-name">
            {p.name}
            {p.isLocal && <span className="resx-you">YOU</span>}
          </span>
          <span className="resx-roster-meta">
            {prettyDrivetrain(p.drivetrain)}
            {showElo && p.elo && (
              <span className="resx-elo" title={`ELO ${p.elo.before} → ${p.elo.after}`}>
                {p.elo.after >= p.elo.before ? '▲' : '▼'}
                {Math.abs(p.elo.after - p.elo.before)}
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** one scoring-category row, alliance-relative: `[label, value]` (solo) or `[label, red, blue]`
 * (versus). */
type SoloSection = readonly [string, readonly (readonly [string, number])[]];
type VersusSection = readonly [string, readonly (readonly [string, number, number])[]];

/** the shared centre breakdown table for a VERSUS match — one table, red value left /
 * category middle / blue value right, exactly the official board's anatomy. Rows cascade
 * in top-to-bottom once `rowsActive`, each pair counting up on its own beat. */
function BreakdownTable({
  sections,
  rowsActive,
}: {
  sections: readonly VersusSection[];
  rowsActive: boolean;
}) {
  let i = -1;
  return (
    <table className="resx-breakdown" aria-label="Score breakdown">
      <tbody>
        {sections.map(([title, rows]) => (
          <Fragment key={title}>
            <tr className="resx-section">
              <th className="resx-section-label" colSpan={3} scope="colgroup">
                {title}
              </th>
            </tr>
            {rows.map(([label, rv, bv]) => {
              i++;
              const idx = i;
              return (
                <tr key={label} className="resx-row" style={{ animationDelay: `${Math.min(idx, 10) * 55}ms` }}>
                  <td className="resx-rv">
                    <RowVal value={rv} run={rowsActive} index={idx} />
                  </td>
                  <td className="resx-cat">{label}</td>
                  <td className="resx-bv">
                    <RowVal value={bv} run={rowsActive} index={idx} />
                  </td>
                </tr>
              );
            })}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

/** the SOLO breakdown, sitting beside the total inside the one alliance half — same
 * cascading rows, single value column. */
function SoloTable({ sections, rowsActive }: { sections: readonly SoloSection[]; rowsActive: boolean }) {
  let i = -1;
  return (
    <table className="resx-breakdown resx-breakdown-solo" aria-label="Score breakdown">
      <tbody>
        {sections.map(([title, rows]) => (
          <Fragment key={title}>
            <tr className="resx-section">
              <th className="resx-section-label" colSpan={2} scope="colgroup">
                {title}
              </th>
            </tr>
            {rows.map(([label, v]) => {
              i++;
              const idx = i;
              return (
                <tr key={label} className="resx-row" style={{ animationDelay: `${Math.min(idx, 10) * 55}ms` }}>
                  <td className="resx-cat">{label}</td>
                  <td className="resx-val">
                    <RowVal value={v} run={rowsActive} index={idx} />
                  </td>
                </tr>
              );
            })}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

/**
 * ONE ALLIANCE HALF — full height, solid alliance fill. Team rows at the top, a huge total
 * at the bottom; the versus breakdown lives in the shared `BreakdownTable` between the two
 * halves, but a SOLO half draws its own (`soloSections`), beside the total, per the brief.
 */
function AllianceHalf({
  alliance,
  phase,
  win,
  tie,
  standing,
  roster,
  showElo,
  total,
  totalLabel = 'TOTAL',
  soloSections,
  rowsActive,
}: {
  alliance: Alliance;
  phase: Phase;
  win: boolean;
  tie: boolean;
  standing?: React.ReactNode;
  roster: readonly RosterEntry[];
  showElo: boolean;
  total: number;
  totalLabel?: string;
  soloSections?: readonly SoloSection[];
  rowsActive: boolean;
}) {
  const settled = phase !== 'wait' && phase !== 'wipe';
  const totalsActive = phase === 'totals' || phase === 'done';
  return (
    <section className={`resx-half ${alliance}`}>
      <div className="resx-half-top">
        <div className="resx-half-head">
          <h3 className="resx-half-name">{alliance.toUpperCase()}</h3>
          {totalsActive && win && <span className="resx-winbanner">WINNER</span>}
          {totalsActive && tie && <span className="resx-winbanner tie">TIE</span>}
        </div>
        {settled && standing}
        {settled && <RosterList roster={roster} showElo={showElo} />}
      </div>
      {/* VERSUS: this wraps just the total, which `margin-top: auto` pins to the half's
          bottom edge. SOLO: it wraps the breakdown table TOO, and `.resx-body-solo` turns
          it into a row — "breakdown beside the big total", per the brief. */}
      <div className="resx-half-lower">
        {soloSections && <SoloTable sections={soloSections} rowsActive={rowsActive} />}
        <div className="resx-total">
          <span className="resx-total-label">{totalLabel}</span>
          <strong className={`resx-total-num ${totalsActive ? 'landed' : ''}`}>
            {totalsActive ? total : '–'}
          </strong>
        </div>
      </div>
    </section>
  );
}

/**
 * The rematch control, in EVERY multiplayer mode — ranked, custom and record alike.
 *
 * It reads its pressed state from the SERVER tally rather than a local guess, so
 * everyone in the room always sees the same count, and it is a VOTE: the match only
 * restarts once every connected driver has pressed it. Declining costs nothing —
 * you simply do not press — which is what makes "everyone agrees" a gate rather
 * than a way to lean on somebody.
 */
function RematchVote({
  vote,
  onToggle,
}: {
  vote: { votes: number; need: number; mine: boolean };
  onToggle: () => void;
}) {
  const waiting = vote.mine && vote.votes < vote.need;
  return (
    <button className={vote.mine ? 'primary' : ''} onClick={onToggle}>
      {waiting ? 'WAITING…' : '⟲ REMATCH'} {vote.votes}/{vote.need}
    </button>
  );
}

/** focuses the first button in the actions row the moment it appears (phase `done`), so a
 * keyboard/switch user lands on the primary action without hunting for it. */
function useFocusPrimaryAction(show: boolean): React.RefObject<HTMLDivElement> {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (show) ref.current?.querySelector('button')?.focus({ preventScroll: true });
  }, [show]);
  return ref;
}

/** final match results — a full-screen RED | BLUE broadcast board, like the FTC audience
 * display. Foul rows show the fouls each alliance COMMITTED (its own count) — the POINTS
 * for those go to the OPPONENT's total (see the footnote), so a foul always benefits the
 * fouled alliance. */
export function Results({
  hud,
  final,
  lost,
  ranked,
  eloResults,
  canRematch,
  onRematch,
  rematchVote,
  onRematchVote,
  onQueueAgain,
  onBackToLobby,
  onExit,
  matchResult,
  practiceRun,
  recordResult,
  signedIn,
  lanHost,
  onWatchReplay,
  reportable,
  onReport,
  onReportScore,
  localRobotId,
}: {
  hud: HudSnapshot;
  /** the score is FINALIZED (see `HudSnapshot.resultFinal`) — the reveal lands then, not on a timer */
  final: boolean;
  /** the final score never arrived (see `HudSnapshot.resultLost`) */
  lost: boolean;
  /** ranked match? shows per-driver ELO deltas inline in the roster */
  ranked: boolean;
  /** per-driver ELO changes, or null until the server's eloResult lands */
  eloResults: EloResultRow[] | null;
  /** SOLO only (`!session` at the call site) — doubles as the single-alliance-half
   *  layout switch: a solo run has nobody to show an opposing half for. */
  canRematch: boolean;
  onRematch: () => void;
  /** duo-record co-op vote (null unless this run has one) */
  rematchVote: { votes: number; need: number; mine: boolean } | null;
  onRematchVote: () => void;
  onQueueAgain?: () => void;
  onBackToLobby?: () => void;
  onExit: () => void;
  matchResult: MatchResultInfo | null;
  /**
   * The finished SOLO PRACTICE run, kept apart from `matchResult` on purpose: that one is the
   * SERVER's authoritative payload, and a locally produced stand-in would quietly claim this
   * score was witnessed. Nothing witnessed it — that is what offline means — and the replay is
   * offered on exactly those terms.
   */
  practiceRun: { replay: Replay; result: ReplayResult } | null;
  /** record run's leaderboard standing, or null until the server's recordResult
   * lands (or forever if anonymous) */
  recordResult: RecordRankInfo | null;
  signedIn: boolean;
  /** on a LAN match, is THIS client the one hosting it? — decides which of the two LAN
   *  lines the results screen shows, since only the host keeps the match */
  lanHost?: boolean;
  onWatchReplay?: (replay: Replay) => void;
  /** the OTHER drivers in this match, reportable by robot id (empty in solo) */
  reportable?: { robotId: number; name: string }[];
  /** send a report; absent in solo / on an older session */
  onReport?: (robotId: number, reason: string, detail: string) => void;
  /** file a MISSCORE claim about this match — see ScoreReportDialog */
  onReportScore?: (detail: string) => void;
  /** this client's own robot id (`GameController.localRobotId`) — marks the "YOU" row
   *  in a roster built from `matchResult`/`practiceRun`'s recorded setups. Optional so
   *  an older caller still renders (just without the marker). */
  localRobotId?: number;
}) {
  const [reporting, setReporting] = useState(false);
  const [scoreReporting, setScoreReporting] = useState(false);
  const [scoreReported, setScoreReported] = useState(false);
  const red = hud.alliance === 'red' ? hud.score : hud.oppScore;
  const blue = hud.alliance === 'blue' ? hud.score : hud.oppScore;
  /**
   * THE TOTALS SHOWN ARE THE SAVED ONES. Online, the server's finalized result is the score of
   * record; the HUD beside it is this client's PREDICTED world, which can run a few ticks past
   * the last snapshot. The breakdown rows still come from the HUD — the field has settled by the
   * time this reveals, so they agree — but the numbers a driver reads as "the score" are exactly
   * the numbers that were saved. Solo practice has no server, and its own world IS the result.
   */
  const saved = matchResult?.result ?? null;
  const redFinal = saved ? saved.score.red : red.total;
  const blueFinal = saved ? saved.score.blue : blue.total;
  const winner: Alliance | 'tie' =
    redFinal > blueFinal ? 'red' : blueFinal > redFinal ? 'blue' : 'tie';

  // RECORD runs are opponent-free score attacks: no winner, and the player's own
  // fouls (which are "awarded" to the empty opposing alliance) SUBTRACT from the
  // net score shown + saved.
  const isRecord = matchResult?.kind === 'record';
  const mine = hud.score; // the player's own breakdown
  const penaltyPts = hud.oppScore.foulPoints; // points the player's fouls handed the empty opponent
  const oppAlliance: Alliance = hud.alliance === 'red' ? 'blue' : 'red';
  const netScore = saved
    ? Math.max(0, saved.score[hud.alliance] - saved.foulPoints[oppAlliance])
    : Math.max(0, mine.total - penaltyPts);

  const revealed = final;
  const { phase, skip } = usePhase(revealed);
  const rowsActive = phase === 'rows' || phase === 'totals' || phase === 'done';
  const totalsActive = phase === 'totals' || phase === 'done';
  const doneVisible = phase === 'done';
  // the totals count up as part of the TOTALS BEAT, not the instant the score reveals —
  // the suspense is the point (see the phase doc comment above).
  const redTotal = useCountUp(redFinal, totalsActive, 700);
  const blueTotal = useCountUp(blueFinal, totalsActive, 700);
  const netTotal = useCountUp(netScore, totalsActive, 700);
  const eloNote = useEloPending(ranked, eloResults);
  const actionsRef = useFocusPrimaryAction(doneVisible);

  // THE ROSTER, for both branches below: who actually played, pulled from the match's own
  // recorded setups rather than a second roster the server would have to send separately.
  // `Replay.setups` already has to exist for the run to be reproducible.
  const replay = matchResult?.replay ?? practiceRun?.replay ?? null;
  const setups = replay?.setups ?? [];
  const redRoster = rosterFor(setups, 'red', localRobotId, ranked ? eloResults : null);
  const blueRoster = rosterFor(setups, 'blue', localRobotId, ranked ? eloResults : null);

  if (isRecord) {
    return (
      <RecordResults
        hud={hud}
        mine={mine}
        penaltyPts={penaltyPts}
        netTotal={netTotal}
        revealed={revealed}
        lost={lost}
        practiceRun={practiceRun}
        recordResult={recordResult}
        signedIn={signedIn}
        matchResult={matchResult}
        canRematch={canRematch}
        onRematch={onRematch}
        rematchVote={rematchVote}
        onRematchVote={onRematchVote}
        onExit={onExit}
        onWatchReplay={onWatchReplay}
        roster={hud.alliance === 'red' ? redRoster : blueRoster}
      />
    );
  }

  const cr = hud.game === 'chain';
  const f = hud.fouls; // fouls COMMITTED by each alliance
  const val = (get: (s: ScoreBreakdown) => number): [number, number] => [get(red), get(blue)];

  // Chain Reaction has its own scoring: Particle points (catalyst multiplier folded in) +
  // End Game (park 5 / ascend 100) + penalty points awarded from the OPPONENT's fouls.
  const crSections = (): VersusSection[] => {
    const c = hud.chain;
    if (!c) return [];
    const isRed = hud.alliance === 'red';
    const redP = isRed ? c.particlePts : c.oppParticlePts;
    const blueP = isRed ? c.oppParticlePts : c.particlePts;
    const redF = isRed ? c.foulPts : c.oppFoulPts;
    const blueF = isRed ? c.oppFoulPts : c.foulPts;
    return [
      ['SCORING', [['Particles ×mult', redP, blueP]]],
      ['RING STAND / PARK', [['Descend / Ascend / Park', red.total - redP - redF, blue.total - blueP - blueF]]],
      ['PENALTIES', [['Fouls awarded', redF, blueF]]],
    ];
  };

  // a game's OWN breakdown, through the module slot. Its rows are
  // alliance-RELATIVE ([label, mine, opp]) — this screen prints red | blue.
  const own = moduleFor(hud.game).resultsRows;
  const ownSections = (): VersusSection[] =>
    (own?.(hud) ?? []).map(([title, rows]) => [
      title,
      rows.map(([label, mine2, opp2]) =>
        hud.alliance === 'red' ? [label, mine2, opp2] : [label, opp2, mine2],
      ) as (readonly [string, number, number])[],
    ]);

  const sections: VersusSection[] = own
    ? ownSections()
    : cr
    ? crSections()
    : [
        [
          'AUTONOMOUS',
          [
            ['Leave', ...val((s) => s.leave)],
            ['Classified', ...val((s) => s.autoClassified)],
            ['Overflow', ...val((s) => s.autoOverflow)],
            ['Pattern', ...val((s) => s.autoPattern)],
          ],
        ],
        [
          'DRIVER-CONTROLLED',
          [
            ['Classified', ...val((s) => s.teleClassified)],
            ['Overflow', ...val((s) => s.teleOverflow)],
            ['Pattern', ...val((s) => s.telePattern)],
          ],
        ],
        [
          'END OF MATCH',
          [
            ['Depot', ...val((s) => s.depot)],
            ['Base return', ...val((s) => s.base)],
          ],
        ],
        [
          // penalty POINTS awarded to each alliance (from the OPPONENT's fouls) —
          // shown as points, not counts, so the breakdown reconciles with each TOTAL
          'PENALTIES',
          [
            ['Minor', f.blue.minor * PTS_FOUL_MINOR, f.red.minor * PTS_FOUL_MINOR],
            ['Major', f.blue.major * PTS_FOUL_MAJOR, f.red.major * PTS_FOUL_MAJOR],
          ],
        ],
      ];

  // SOLO (`!session` at the call site, forwarded as `canRematch`) has nobody to show an
  // opposing half for — a practice dummy is `passive` and never appears in the roster,
  // and a bare `mode: 'match'` solo run has no bot opponent yet (see games/types.ts).
  const solo = canRematch;
  const season = seasonFor(hud.game).name;
  const format = redRoster.length && blueRoster.length ? `${redRoster.length}V${blueRoster.length}` : '';
  const modeLabel = solo
    ? 'SOLO PRACTICE'
    : ranked
      ? `RANKED${format ? ` ${format}` : ''}`
      : lanActive()
        ? `LAN${format ? ` ${format}` : ''}`
        : `CUSTOM${format ? ` ${format}` : ''}`;

  const soloSections: SoloSection[] | undefined = solo
    ? sections.map(([title, rows]) => [
        title,
        rows.map(([label, rv, bv]) => [label, hud.alliance === 'red' ? rv : bv] as [string, number]),
      ])
    : undefined;

  return (
    <div
      className="resx-stage"
      onClick={skip}
      role="dialog"
      aria-label="Match results"
    >
      {phase !== 'wait' && (
        <div className="resx-sting" aria-hidden="true">
          MATCH RESULTS
        </div>
      )}
      <header className="resx-bar">
        <span className="resx-eyebrow">{modeLabel}</span>
        <h2 className="resx-title">{revealed ? 'MATCH RESULTS' : 'FINAL SCORE'}</h2>
        <span className="resx-season">{season}</span>
      </header>
      {!revealed && (
        <p className="resx-wait">
          {lost
            ? 'Couldn’t get the final score from the server. Check Career for the result.'
            : 'Waiting for the field to settle…'}
        </p>
      )}
      {phase !== 'wait' && (
        <div className="resx-body">
          {solo ? (
            <AllianceHalf
              alliance={hud.alliance}
              phase={phase}
              win={false}
              tie={false}
              roster={hud.alliance === 'red' ? redRoster : blueRoster}
              showElo={false}
              total={hud.alliance === 'red' ? redTotal : blueTotal}
              soloSections={soloSections}
              rowsActive={rowsActive}
            />
          ) : (
            <>
              <AllianceHalf
                alliance="red"
                phase={phase}
                win={winner === 'red'}
                tie={winner === 'tie'}
                roster={redRoster}
                showElo={ranked}
                total={redTotal}
                rowsActive={rowsActive}
              />
              <BreakdownTable sections={sections} rowsActive={rowsActive} />
              <AllianceHalf
                alliance="blue"
                phase={phase}
                win={winner === 'blue'}
                tie={winner === 'tie'}
                roster={blueRoster}
                showElo={ranked}
                total={blueTotal}
                rowsActive={rowsActive}
              />
            </>
          )}
        </div>
      )}
      {doneVisible && (
        <div className="resx-secondary">
          {/* A VOIDED total is 0 with a full breakdown above it, which reads as a bug unless
              the reason is stated. Say it plainly. */}
          {(red.voided || blue.voided) && (
            <p className="resx-void">
              RED CARD — {red.voided && blue.voided ? 'both alliances have' : `${red.voided ? 'RED' : 'BLUE'} has`}{' '}
              forfeited the match. Points earned are shown above but do not count.
            </p>
          )}
          {eloNote && <p className="resx-note">{eloNote}</p>}
          {matchResult && (
            <p className="resx-note ok">
              {/* A LAN MATCH WAS NOT RECORDED BY THE SERVER THAT RAN IT, and "✓ Match recorded."
                  is simply false there — a LAN box has no database. What actually happened
                  depends on which end of the room you are, so it says which: the HOST keeps it
                  (and their account gets it once they are online), and a guest keeps nothing. */}
              {lanActive()
                ? lanHost
                  ? signedIn
                    ? '✓ Saved on this computer. It goes to your account next time you’re online.'
                    : '✓ Saved on this computer. Sign in to save it to your account.'
                  : '✓ Match over. The host keeps the replay.'
                : matchResult.kind === 'record'
                  ? '✓ Recorded - sign in to save it to the leaderboard.'
                  : '✓ Match recorded.'}
            </p>
          )}
          {/* A practice run says what it IS. It was not on a leaderboard and never will be —
              offline has no authority to put it there — so the copy promises only what happened:
              the run is kept, and it is yours to watch. */}
          {practiceRun && !matchResult && (
            <p className="resx-note ok">
              {signedIn
                ? '✓ Saved to your practice replays.'
                : '✓ Saved on this device. Sign in to keep it on your account.'}
            </p>
          )}
          <div className="overlay-buttons" ref={actionsRef} onClick={(e) => e.stopPropagation()}>
            {(matchResult ?? practiceRun) && onWatchReplay && (
              <button onClick={() => onWatchReplay((matchResult ?? practiceRun)!.replay)}>
                ▶ WATCH REPLAY
              </button>
            )}
            {canRematch && <button onClick={onRematch}>REMATCH</button>}
            {rematchVote && <RematchVote vote={rematchVote} onToggle={onRematchVote} />}
            {/* the OTHER thing you want after a ranked match. REMATCH beside it plays
                the same people again; this finds new ones without going out to the
                menu and back in through Play ▸ Ranked. */}
            {onQueueAgain && <button onClick={onQueueAgain}>QUEUE AGAIN</button>}
            {/* REMATCH plays these same people on these same sides. This re-opens the room,
                so the next game is built from whoever is in it then — which is what you want
                when somebody left, or when the sides want swapping. */}
            {onBackToLobby && <button onClick={onBackToLobby}>BACK TO LOBBY</button>}
            {/* the EXIT, not a fourth primary: `.overlay-buttons button` is accent-filled
                unless `.ghost`, so an unmarked MENU sat beside REMATCH and WATCH REPLAY
                with nothing saying which one the screen expects. */}
            <button className="ghost" onClick={onExit}>
              MENU
            </button>
          </div>
          {/* REPORT is deliberately not in the button row. It is a rare, deliberate action and
              the row is where REMATCH and MENU live — the two things every player reaches for
              every match. A quiet link below keeps it available without putting it under a
              thumb aiming for the exit. */}
          {onReport && reportable && reportable.length > 0 && !reporting && (
            <button
              className="ds-linkbtn results-report resx-linkbtn"
              onClick={(e) => {
                e.stopPropagation();
                setReporting(true);
              }}
            >
              ⚑ Report a player
            </button>
          )}
          {/* ...and the SCORE itself. A separate action from reporting a player because it is a
              separate claim: the score is the server's arithmetic, so a wrong one is nobody's
              misconduct and asking the reporter to name a culprit would be asking them to
              invent one. Only offered on a match that actually SCORED (a record run has its own
              number and no opponent to dispute it with). */}
          {onReportScore && matchResult && !scoreReporting && !scoreReported && (
            <button
              className="ds-linkbtn results-report resx-linkbtn"
              onClick={(e) => {
                e.stopPropagation();
                setScoreReporting(true);
              }}
            >
              ⚖ Report a misscore
            </button>
          )}
          {scoreReported && <p className="results-report-done resx-linkbtn">Misscore reported. A moderator will check the replay.</p>}
          {scoreReporting && onReportScore && (
            <ScoreReportDialog
              onSubmit={(detail) => {
                onReportScore(detail);
                setScoreReported(true);
                setScoreReporting(false);
              }}
              onClose={() => setScoreReporting(false)}
            />
          )}
          {reporting && onReport && reportable && (
            <ReportDialog
              drivers={reportable}
              onSubmit={(rid, reason, detail) => onReport(rid, reason, detail)}
              onClose={() => setReporting(false)}
            />
          )}
          {/* AFTER the buttons, deliberately. The results screen is a good place for an ad —
              the match is over and the player is reading rather than driving — but REMATCH and
              MENU must stay the first things reachable, by mouse and by tab order. */}
          <ResultsAd />
        </div>
      )}
    </div>
  );
}

/** the PB / WR / rank line on a record run's results screen. Null info ⇒ either
 * the run is still being scored (signed in) or it was anonymous (prompt to sign
 * in — anonymous runs are never persisted, so no rank exists). Takes the WINNER
 * banner's slot in the layout when earned. */
function RecordStanding({ info, signedIn }: { info: RecordRankInfo | null; signedIn: boolean }) {
  if (!info) {
    // alpha builds are not persisted server-side (no recordResult ever arrives) —
    // don't leave a signed-in player spinning on "Saving…"
    if (appChannel() === 'alpha') {
      return <p className="resx-standing pending">Not saved on this test build.</p>;
    }
    return signedIn ? (
      <p className="resx-standing pending">Saving · computing your rank…</p>
    ) : (
      <p className="resx-standing signin">Sign in to save this run &amp; see your rank →</p>
    );
  }
  const cat = `${info.mode === 'duo' ? 'Duo' : 'Solo'} · ${prettyDrivetrain(info.drivetrain)}`;
  if (info.isWR) {
    return (
      <div className="resx-standing wr">
        <strong>🏆 WORLD RECORD</strong>
        <span>
          {cat} · #1 of {info.total}
        </span>
      </div>
    );
  }
  if (info.isPB) {
    return (
      <div className="resx-standing pb">
        <strong>★ NEW PERSONAL BEST</strong>
        <span>
          {cat} · #{info.rank} of {info.total}
        </span>
      </div>
    );
  }
  return (
    <div className="resx-standing rank">
      <strong>#{info.rank}</strong>
      <span>
        of {info.total} · {cat}
      </span>
    </div>
  );
}

/** opponent-free record-run results: one net score (own penalties subtracted), a PB / WR /
 * rank line, and a single-column breakdown beside the total. No opponent, no winner — the
 * same full-screen anatomy as a versus match, just one alliance half, centred. */
function RecordResults({
  hud,
  mine,
  penaltyPts,
  netTotal,
  revealed,
  lost,
  recordResult,
  signedIn,
  matchResult,
  practiceRun,
  canRematch,
  onRematch,
  rematchVote,
  onRematchVote,
  onExit,
  onWatchReplay,
  roster,
}: {
  hud: HudSnapshot;
  mine: ScoreBreakdown;
  penaltyPts: number;
  netTotal: number;
  revealed: boolean;
  /** the final score never arrived — see `HudSnapshot.resultLost` */
  lost: boolean;
  recordResult: RecordRankInfo | null;
  signedIn: boolean;
  matchResult: MatchResultInfo | null;
  /** the finished SOLO PRACTICE run — see the note on the other results screen */
  practiceRun: { replay: Replay; result: ReplayResult } | null;
  canRematch: boolean;
  onRematch: () => void;
  /** duo-record co-op vote (null unless this run has one) */
  rematchVote: { votes: number; need: number; mine: boolean } | null;
  onRematchVote: () => void;
  onExit: () => void;
  onWatchReplay?: (replay: Replay) => void;
  /** who ran it — one row solo, two for a duo-record — from the replay's own setups */
  roster: readonly RosterEntry[];
}) {
  const cr = hud.game === 'chain';
  const f = hud.fouls[hud.alliance]; // fouls the PLAYER committed
  const { phase, skip } = usePhase(revealed);
  const rowsActive = phase === 'rows' || phase === 'totals' || phase === 'done';
  const totalsActive = phase === 'totals' || phase === 'done';
  const doneVisible = phase === 'done';
  const netCount = useCountUp(netTotal, totalsActive, 700);

  // the game's own breakdown, through the module slot. A solo run has no opponent,
  // so only the "mine" half of each row is printed.
  const own = moduleFor(hud.game).resultsRows;
  const sections: SoloSection[] = own
    ? (own(hud) ?? []).map(([title, rows]) => [
        title,
        rows.map(([label, v]) => [label, v] as [string, number]),
      ])
    : cr && hud.chain
      ? [
          ['SCORING', [['Particles ×mult', hud.chain.particlePts]]],
          ['END GAME', [['Park / Ascend', mine.total - hud.chain.particlePts - hud.chain.foulPts]]],
        ]
      : [
          ['AUTONOMOUS', [
            ['Leave', mine.leave],
            ['Classified', mine.autoClassified],
            ['Overflow', mine.autoOverflow],
            ['Pattern', mine.autoPattern],
          ]],
          ['DRIVER-CONTROLLED', [
            ['Classified', mine.teleClassified],
            ['Overflow', mine.teleOverflow],
            ['Pattern', mine.telePattern],
          ]],
          ['END OF MATCH', [
            ['Depot', mine.depot],
            ['Base return', mine.base],
          ]],
        ];
  // PENALTIES belongs to whoever owns the breakdown: a game with its own `resultsRows`
  // puts its penalty row in `sections`, and printing this one too would show the
  // heading twice. `!own` is `!cr` for both games that existed - neither filled the slot.
  if (!own) {
    sections.push([
      'PENALTIES',
      [[`Fouls committed (${f.minor} minor · ${f.major} major)`, penaltyPts > 0 ? -penaltyPts : 0]],
    ]);
  }

  const season = seasonFor(hud.game).name;
  const duo = roster.length > 1;
  const modeLabel = `${duo ? 'DUO' : 'SOLO'} RECORD RUN`;
  const actionsRef = useFocusPrimaryAction(doneVisible);

  return (
    <div
      className="resx-stage"
      onClick={skip}
      role="dialog"
      aria-label="Run results"
    >
      {phase !== 'wait' && (
        <div className="resx-sting" aria-hidden="true">
          RUN COMPLETE
        </div>
      )}
      <header className="resx-bar">
        <span className="resx-eyebrow">{modeLabel}</span>
        <h2 className="resx-title">{revealed ? 'RUN COMPLETE' : 'FINAL SCORE'}</h2>
        <span className="resx-season">{season}</span>
      </header>
      {!revealed && (
        <p className="resx-wait">
          {lost
            ? 'Couldn’t get the final score from the server. Check Career for the result.'
            : 'Waiting for the field to settle…'}
        </p>
      )}
      {phase !== 'wait' && (
        <div className="resx-body resx-body-solo">
          <AllianceHalf
            alliance={hud.alliance}
            phase={phase}
            win={false}
            tie={false}
            standing={phase !== 'wipe' ? <RecordStanding info={recordResult} signedIn={signedIn} /> : null}
            roster={roster}
            showElo={false}
            total={netCount}
            totalLabel={cr ? 'TOTAL' : 'NET SCORE'}
            soloSections={sections}
            rowsActive={rowsActive}
          />
        </div>
      )}
      {doneVisible && (
        <div className="resx-secondary">
          <div className="overlay-buttons" ref={actionsRef} onClick={(e) => e.stopPropagation()}>
            {(matchResult ?? practiceRun) && onWatchReplay && (
              <button onClick={() => onWatchReplay((matchResult ?? practiceRun)!.replay)}>
                ▶ WATCH REPLAY
              </button>
            )}
            {canRematch && <button onClick={onRematch}>RUN AGAIN</button>}
            {/* CO-OP: the run belongs to both drivers, so restarting is a vote —
                the same control (and the same R binding) as mid-match. */}
            {rematchVote && <RematchVote vote={rematchVote} onToggle={onRematchVote} />}
            <button className="ghost" onClick={onExit}>
              MENU
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
