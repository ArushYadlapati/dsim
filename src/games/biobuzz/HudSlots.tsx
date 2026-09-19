import { useRef } from 'react';
import type { Alliance } from '../../types';
import type { HudSnapshot } from '../../game';
import type { ArtifactColor } from '../../types';
import type { GameBuilderProps, GameHudProps, ResultsSection } from '../module';
import { BiobuzzBuilder } from './Builder';
import { BB_NECTAR_COUNT, BB_PTS, BB_RP } from './config';
import type { BbCellHud, BbPinHud, BiobuzzFieldHud } from './hud';
import type { BiobuzzHud } from './hudRobot';
import type { BbAllianceScore, BbRankPoints } from './score';

/**
 * The BIOBUZZ UI SLOTS that need JSX — the builder adapter, the two live-HUD slots and the
 * results breakdown. `index.ts` stays a plain registration, like `chain/index.ts`, because a
 * `.tsx` module index would be the one file in `src/games/` that resolves differently.
 *
 * Everything here reads `HudSnapshot.gameHud`, which is the game's own HUD slice
 * (`GameSimModule.hud` → `hudRobot.ts`'s `biobuzzHud`). It is typed `unknown` at the seam on
 * purpose: only this game's own components know its shape, so the cast happens HERE, once, in
 * `sliceOf`, rather than at every read.
 *
 * ── WHY THIS FILE CARRIES SO MUCH OF THE GAME ───────────────────────────────
 * The BIOBUZZ field draws STATE and never text: a CELL's contents are a row of discs, a
 * FLOWER's stack is a column of discs outside the wall, and there are no letters or digits
 * anywhere in a match (field-plan §2.5, owner ruling 2026-09-12). Everything a driver has to
 * COUNT rather than SEE therefore has to be here, and `hud.ts` exists to supply exactly that
 * list. A chip removed from this file is a number a driver cannot get any other way.
 */

/** the game's HUD slice off the snapshot. Undefined when a snapshot predates this game. */
const sliceOf = (hud: HudSnapshot): BiobuzzHud | undefined => hud.gameHud as BiobuzzHud | undefined;

/** the OTHER alliance. One spelling, because the results rows need it on every line. */
const other = (a: Alliance): Alliance => (a === 'red' ? 'blue' : 'red');

/**
 * The BUILDER props ADAPTER.
 *
 * The slot hands over `{ spec, onChange, game }` — a PARTIAL patch callback, because a builder
 * must not know where a spec is stored — and `BiobuzzBuilder` takes `{ spec, setSpec }`, which
 * is the same contract under this game's own spelling. `game` is dropped: a per-game builder
 * already knows which game it is, and reading it would be the first step back toward one
 * component with a branch per season.
 */
export function BiobuzzBuilderSlot({ spec, onChange }: GameBuilderProps) {
  return <BiobuzzBuilder spec={spec} setSpec={onChange} />;
}

/** the words for one held element, for the row's accessible name. POLLEN is yellow; a NECTAR
 * is named by its alliance colour because whose NECTAR it is decides what it may do. */
const HELD_WORD: Partial<Record<ArtifactColor, string>> = {
  yellow: 'POLLEN',
  red: 'red NECTAR',
  blue: 'blue NECTAR',
};

/** "Holding 2 POLLEN, 1 red NECTAR. Next out: red NECTAR" — the disc row said in words. */
function heldPhrase(held: readonly ArtifactColor[]): string {
  if (held.length === 0) return 'Holding nothing';
  const word = (c: ArtifactColor): string => HELD_WORD[c] ?? c;
  const counts = (['yellow', 'red', 'blue'] as const)
    .map((c) => [c, held.filter((h) => h === c).length] as const)
    .filter(([, n]) => n > 0)
    .map(([c, n]) => `${n} ${word(c)}`);
  return `Holding ${counts.join(', ')}. Next out: ${word(held[held.length - 1])}`;
}

/**
 * THE UP-CELL LINE: how many more POLLEN would TIP this alliance's HIVE.
 *
 * A NUMBER, never a word. `BB_TIP_POLLEN` is a measured table indexed by the NECTAR count
 * (reference §4.1) — 3 NECTAR takes 3 POLLEN, 2 takes 6 — so "a few more" is not something a
 * driver can act on, and it is not derivable from the discs the field draws. `needed` 0 means
 * the next element takes it and still prints as 0 rather than as READY: every other value
 * this line shows is a count of shots, and so is that one.
 *
 * TIPPING wins over the number for the 4 s of the swing. The HIVE does keep taking elements
 * through it (`hiveTakingSide`), but which tray it is putting them in changes at the release,
 * so a count of "more to tip" against a moving bar is a number about to be answered by a
 * different cell.
 */
const cellLine = (c: BbCellHud | undefined): string =>
  !c ? '' : c.tipping > 0 ? 'TIPPING' : `${c.needed} MORE TO TIP`;

const fmtTime = (s: number): string => {
  const t = Math.max(0, Math.ceil(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

/** seconds a G407 CONTROL warning stays on screen after the count moves. */
const BB_WARN_HOLD_S = 3;

/**
 * THE PIN THAT BILLS SOONEST, or null when nobody is pinning.
 *
 * `pins` is usually empty and holds more than one entry only in a genuine multi-robot tangle.
 * The chip shows ONE, and it is the one with the least time left on its tariff: every entry
 * carries the same 20-point-per-3-second clock, so the soonest is the only one whose number
 * changes what either driver does in the next second.
 */
const soonestPin = (pins: readonly BbPinHud[] | undefined): BbPinHud | null =>
  !pins || pins.length === 0 ? null : pins.reduce((a, b) => (b.nextIn < a.nextIn ? b : a));

/**
 * THE PIN LINE. `PIN · 20 IN 1.4 S` — the ACT, the tariff, and the seconds until it lands.
 *
 * ONE DECIMAL, and that is the point of the line. `nextIn` runs 3 → 0 and a whole-second
 * readout would spend a third of every tariff cycle showing the same digit while 20 points
 * moved; the tenths are what make it read as a countdown rather than as a label. `billed` is
 * appended only once it is non-zero, because a PIN that has not yet cost anything is a warning
 * and a PIN that has is a running bill, and the driver reaction to the two is different.
 */
const pinLine = (p: BbPinHud): string =>
  `PIN · ${BB_PTS.foulMajor} IN ${p.nextIn.toFixed(1)} S` +
  (p.billed > 0 ? ` · ${p.billed * BB_PTS.foulMajor} BILLED` : '');

// 8 NECTAR/alliance = 3 staged in the HIVE at kickoff + 5 stock (spawn.ts's NECTAR_PER_CELL /
// NECTAR_STOCK — Lane A constants, not exported, so this total is kept in sync by comment
// rather than a cross-lane import). BB_NECTAR_COUNT (config.ts) is the total's single source
// of truth.
const NECTAR_STAGED = 3;
const NECTAR_STOCK_MAX = BB_NECTAR_COUNT - NECTAR_STAGED;

/** the NECTAR dot row's accessible name — the dots carry no text, so this says the same
 * thing in words: how many are placed, how many are left, and whether a press does anything. */
function nectarPhrase(placed: number, stock: number, available: boolean, ringed: number): string {
  const parts = [`${NECTAR_STAGED + placed} placed`, `${stock} in stock`];
  if (available) parts.push(ringed > 0 ? `${ringed} due now` : 'available');
  return `Nectar: ${parts.join(', ')}.`;
}

/**
 * A CHIP THAT HAS TO OUTLIVE ITS FACT.
 *
 * `warnings` is a monotonic COUNT — G407 moves it by one on the tick a robot takes CONTROL of
 * a fifth SCORING ELEMENT, and it never comes back down. A chip bound to the count itself
 * would therefore be a chip that appears once and then stays up for the rest of the match,
 * which is not what a warning is. So it is bound to the MOMENT the count moved, and held for
 * `BB_WARN_HOLD_S` after it.
 *
 * THE CLOCK IS THE MATCH CLOCK, not `Date.now()`. `GameView` re-samples the HUD every 100 ms
 * and match time is already on the props, so the hold costs no timer of its own: it PAUSES
 * when the match does and it is identical on a replay of the same match, neither of which is
 * true of a `setTimeout`. 100 ms of resolution on a 3 s hold is a 3% error on when the chip
 * goes away, which is not a number anybody reads.
 *
 * `timeLeft` counts DOWN inside a phase and JUMPS UP at a phase boundary, so the hold is only
 * ever measured within ONE phase: a warning drawn in the last second of AUTO does not carry a
 * stale chip into TELEOP, and the arithmetic never sees a negative elapsed.
 */
function useHeldBump(count: number, timeLeft: number, phase: string, hold: number): boolean {
  // `at` starts at -Infinity so a HUD that MOUNTS onto a match already carrying warnings (a
  // spectator joining late, a replay scrubbed into the middle) does not flash one that was
  // drawn before it was watching.
  const seen = useRef({ count, at: -Infinity, phase });
  const s = seen.current;
  if (count !== s.count || phase !== s.phase) {
    s.at = count > s.count && phase === s.phase ? timeLeft : -Infinity;
    s.count = count;
    s.phase = phase;
  }
  const since = s.at - timeLeft;
  return since >= 0 && since < hold;
}

/**
 * The chips in the live HUD's `.robot-status` row — the DRIVER'S ROBOT and the DRIVER'S
 * ALLIANCE ONLY.
 *
 * The split with the score bar is by AUDIENCE, not by subject: the bar is the audience
 * display and prints both alliances, this row is the driver's own strip and prints the facts
 * that change what THEY do next. So the robot half and the alliance half (own CELL, own NECTAR
 * supply) both belong here, and the opponent's numbers do not.
 *
 * TWO COLUMNS, dots only, no wording anywhere (owner ruling 2026-09-12 extended to every chip
 * in this card):
 *  - LEFT, top-aligned: STORAGE — one disc per held element, coloured by element, then a
 *    hollow ring per free slot up to the cap (NEXT-OUT FIRST: the leftmost filled disc carries
 *    the `.next` ring). Under it, bottom-aligned: the FLOWER icon (grey while G410 locks entry,
 *    alliance-yellow once it opens, ringed while `flowerInReach`).
 *  - RIGHT, top-aligned: NECTAR — 8 dots per alliance (see the color/ring rule at
 *    `nectarPhrase`, below).
 * The PIN countdown and the CONTROL 5+ warning do NOT live here — both are transient calls to
 * action rather than standing facts, so `BiobuzzPinnedNotice` renders them above the event log
 * instead (see there).
 * Every row's accessible name says the same thing in words, since the dots carry no text.
 */
export function BiobuzzHudChips({ hud }: GameHudProps) {
  const s = sliceOf(hud);
  const f = s?.field;
  const r = s?.robot;
  const due = f?.nectarDue[hud.alliance] ?? 0;
  const held = r?.held ?? [];
  const free = r ? Math.max(0, r.cap - held.length) : 0;
  const said = heldPhrase(held);

  const stock = f?.nectarStock[hud.alliance] ?? 0;
  const placed = NECTAR_STOCK_MAX - stock;
  const available = f?.nectarWhy[hud.alliance] === 'ok';
  // the dump window: past the 1:00 cue the WHOLE remaining stock may go in with nothing
  // banked, so `due` reads 0 while a press is still granted — ring every dot left in stock.
  const ringCount = !available ? 0 : due > 0 ? Math.min(due, stock) : stock;
  const nectarSaid = nectarPhrase(placed, stock, available, ringCount);

  // G410: grey while locked, alliance-yellow once the FLOWERS open — a standing fill, not a
  // flash (contrast a G407 warning, which genuinely only matters for a few seconds).
  const flowerOpen = f?.nectarLocked === false;
  const flowerSaid = `FLOWER ${flowerOpen ? 'open' : 'locked'}${r?.flowerInReach ? ', in reach' : ''}.`;

  return (
    <div className="bb-hud">
      <div className="bb-hud-left">
        {/* NO ARCHETYPE CHIP. The launcher's name is a thing the driver CHOSE in the builder
            and cannot change mid-match, so it told them nothing they did not already know
            while costing the width of the longest label in `BB_MODE_LABELS`
            ("DOUBLE TURRET"). What the launcher's rules actually DO to the controls is already
            in the controls themselves; the hopper column beside it is the part that changes. */}
        {r && (
          <div className="hopper vertical" role="img" aria-label={said} title={said}>
            {[...held].reverse().map((c, i) => (
              <span key={`h${i}`} className={`hopper-pip ${c}${i === 0 ? ' next' : ''}`} />
            ))}
            {Array.from({ length: free }, (_, i) => (
              <span key={`e${i}`} className="hopper-pip empty" />
            ))}
          </div>
        )}
        {/* NO CELL CHIP. `BiobuzzScoreBar` already prints this alliance's up-CELL line under
            its own score panel — `cellLine`, the same two states ("n MORE TO TIP" / "TIPPING")
            this card used to carry, in the place a driver already watches for the score. */}
        {/* THE FLOWER ICON replaces the old FLOWER IN REACH / FLOWERS OPEN text chips — G410's
            lock is the fill (grey/open), `flowerInReach` is the ring. CONTROL 5+ used to sit
            beside it here; it now lives in the event log with the PIN countdown, below, since
            both are transient calls to action rather than a standing fact like this icon. */}
        {f && (
          <span
            className={`flower-icon${flowerOpen ? ' open' : ''}${r?.flowerInReach ? ' reach' : ''}`}
            role="img"
            aria-label={flowerSaid}
            title={flowerSaid}
          />
        )}
      </div>
      {/* THE NECTAR COLUMN. The 3 staged dots are always alliance-coloured. Of the 5 stock
          dots: already-placed ones (`i < placed`) are alliance-coloured too, and never ringed
          — a placed dot isn't due any more. Of the rest, `nectarWhy === 'ok'` turns a dot from
          grey to alliance-coloured the moment a press would succeed, whether or not it has
          been pressed yet; the ring layers ON TOP of that colour, for the ones within
          `ringCount`, and is never drawn on a grey dot. */}
      {f && (
        <div className="bb-hud-right">
          <div className="hopper vertical" role="img" aria-label={nectarSaid} title={nectarSaid}>
            {Array.from({ length: NECTAR_STAGED }, (_, i) => (
              <span key={`ns${i}`} className={`hopper-pip ${hud.alliance}`} />
            ))}
            {Array.from({ length: NECTAR_STOCK_MAX }, (_, i) => {
              const isPlaced = i < placed;
              const colored = isPlaced || available;
              const ringed = !isPlaced && i - placed < ringCount;
              return (
                <span
                  key={`nk${i}`}
                  className={`hopper-pip${colored ? ` ${hud.alliance}` : ' grey'}${ringed ? ' due' : ''}`}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * THE TWO LIVE WARNINGS, pinned above the event log's toasts while either is active — a PIN's
 * countdown and G407's CONTROL 5+.
 *
 * `BbPinHud.nextIn` ticks continuously, which is exactly the shape the toast log cannot hold —
 * a toast decays after 2.5 s and would have to re-fire every frame to stay lit, which is not a
 * toast, it is a second HUD. CONTROL 5+ isn't continuous the same way, but it is still a call
 * to action rather than a fact ("do something differently right now"), which is what belongs
 * in the driver's eyeline rather than parked as furniture in the HUD card — so it moved here
 * alongside PIN rather than getting a bespoke third home. Both read the live slice directly,
 * through the `pinnedNotice` slot (`GameModule`), and the component renders nothing when
 * neither is active.
 *
 * PIN'S NEUTRAL COLOUR IS DELIBERATE, AND IT IS A GAP: the line cannot yet say whether THIS
 * alliance is the one pinning or the one being held. `BbPinHud` carries robot IDs, and nothing
 * that reaches a HUD component maps an ID to an alliance — `HudSnapshot` has no roster and no
 * local robot ID, and the slice's robot half (Lane B's `hudRobot.ts`) has no ID either. A PIN
 * is always cross-alliance, so the line is always relevant to whoever is reading it and the
 * COUNTDOWN is the same number for both sides (let go / keep trying); only the colour split is
 * blocked. Requested of the master: one `pinnerAlliance: Alliance` on `BbPinHud` and this
 * becomes two differently-coloured lines.
 */
export function BiobuzzPinnedNotice({ hud }: GameHudProps) {
  const f = sliceOf(hud)?.field;
  const pin = soonestPin(f?.pins);
  // G407. The hook runs on every sample, including the ones where an absent slice reads 0, so
  // the hold is measured against the same clock the rest of the HUD is drawn from.
  const warned = useHeldBump(f?.warnings[hud.alliance] ?? 0, hud.timeLeft, hud.phase, BB_WARN_HOLD_S);
  if (!pin && !warned) return null;
  return (
    <>
      {/* G407 — CONTROL of a fifth SCORING ELEMENT. The owner's ruling makes this a WARNING
          worth no points and no card, which is exactly why it needs a line: a sanction that
          moves no number is invisible on a scoreboard unless something says it happened. Held
          `BB_WARN_HOLD_S` off the match clock (see `useHeldBump`), because the underlying count
          never comes back down. */}
      {warned && <div className="eventlog-line eventlog-pinned">CONTROL 5+</div>}
      {/* G421 — a PIN, counting. 20 points every three seconds, and the clock runs in a
          referee's head, so `nextIn` is the only warning either driver gets. */}
      {pin && <div className="eventlog-line eventlog-pinned">{pinLine(pin)}</div>}
    </>
  );
}

const PHASE_LABEL: Record<HudSnapshot['phase'], string> = {
  pre: 'PRE-MATCH',
  auto: 'AUTONOMOUS',
  transition: 'TRANSITION',
  teleop: 'DRIVER-CONTROLLED',
  post: 'FINAL',
  freeplay: 'FREE DRIVE',
};

/**
 * The whole bottom bar — red | timer | blue, each alliance's up-CELL line under its total.
 *
 * It exists because the SHARED bar is DECODE's: it draws the motif dots for every game that
 * is not Chain Reaction, and BIOBUZZ has no motif. The LAYOUT is the shared one on purpose
 * (the same `scorebar` / `score-panel` / `timer-panel` classes), so it themes identically and
 * a driver who plays two games reads the same bar in both. The one addition is the sub-line,
 * which is `.score-panel.bb` stacking its children instead of centring one.
 *
 * The panels show the alliance TOTAL, read from the shared `ScoreBreakdown` rather than from
 * `score[a].total`: the shared number already folds in foul points and already reads 0 for a
 * VOIDED alliance, and a bar that disagreed with the results screen about who is winning
 * would be worse than either number on its own.
 */
export function BiobuzzScoreBar({ hud }: GameHudProps) {
  const f = sliceOf(hud)?.field;
  const red = hud.alliance === 'red' ? hud.score.total : hud.oppTotal;
  const blue = hud.alliance === 'blue' ? hud.score.total : hud.oppTotal;
  const urgent = hud.timeLeft <= 10 && (hud.phase === 'auto' || hud.phase === 'teleop');
  if (hud.mode !== 'match') {
    return (
      <div className="scorebar">
        <div className="timer-panel">
          <span className="timer-phase">FREE DRIVE</span>
        </div>
      </div>
    );
  }
  return (
    <>
      <div className="scorebar">
        <div className={`score-panel bb red ${hud.alliance === 'red' ? 'mine' : ''}`}>
          {hud.alliance === 'red' && <span className="you-tag">YOU</span>}
          <span className="panel-score">{red}</span>
          <span className={`bb-tip ${f && f.cells.red.tipping > 0 ? 'go' : ''}`}>
            {cellLine(f?.cells.red)}
          </span>
        </div>
        <div className={`timer-panel ${urgent ? 'urgent' : ''}`}>
          {/* status on the PHASE only — the digits beside it retick every frame and would
              flood a screen reader. This changes ~4 times a match. */}
          <span className="timer-phase" role="status">
            {PHASE_LABEL[hud.phase]}
          </span>
          <span className="timer-time">{hud.phase === 'post' ? '0:00' : fmtTime(hud.timeLeft)}</span>
        </div>
        <div className={`score-panel bb blue ${hud.alliance === 'blue' ? 'mine' : ''}`}>
          {hud.alliance === 'blue' && <span className="you-tag">YOU</span>}
          <span className="panel-score">{blue}</span>
          <span className={`bb-tip ${f && f.cells.blue.tipping > 0 ? 'go' : ''}`}>
            {cellLine(f?.cells.blue)}
          </span>
        </div>
      </div>
    </>
  );
}

/**
 * The results-screen breakdown — every line of Table 10-2 (§10.5, p91), then the RPs.
 *
 * Rows are ALLIANCE-RELATIVE (`[label, mine, opp]`) because the two screens want different
 * things from the same numbers: the versus results print red | blue, and a solo record run
 * has no opponent column at all.
 *
 * ── COUNTS AND POINTS, BOTH ─────────────────────────────────────────────────
 * Every achievement that has both gets two rows. A points-only table cannot be checked
 * against the field — GARDEN 7 is seven elements at 1 each, and nothing on the screen says
 * so — and a count-only table does not add up to the total printed under it. The
 * parenthetical names the unit, and it is the same word on every row that shares one.
 *
 * ── THERE IS NO TOTAL ROW HERE, DELIBERATELY ────────────────────────────────
 * Both consumers append their own (`GameView`'s `total-row`, off the shared
 * `ScoreBreakdown.total`), so a second one would print the number twice — and would DISAGREE
 * with it on a VOIDED match, where the shared row reads 0 over a full breakdown on purpose.
 * RANKING POINTS is therefore the last section and the screen's own TOTAL closes the table.
 *
 * RPs print as 1 / 0, because a section row is `[label, number, number]`. The threshold goes
 * in the label rather than in a legend: a bare 0 in a numeric column says nothing about what
 * would have earned it. The numbers come from `BB_RP`, so a label cannot drift from the test
 * that sets the flag.
 */
export function biobuzzResultsRows(hud: HudSnapshot): readonly ResultsSection[] {
  const f: BiobuzzFieldHud | undefined = sliceOf(hud)?.field;
  const me = hud.alliance;
  const opp = other(me);
  /** one breakdown field, alliance-relative. An absent slice reads 0, never throws. */
  const n = (s: BbAllianceScore | undefined, k: keyof BbAllianceScore): number => s?.[k] ?? 0;
  const row = (label: string, k: keyof BbAllianceScore) =>
    [label, n(f?.score[me], k), n(f?.score[opp], k)] as const;
  const rp = (label: string, k: keyof BbRankPoints) =>
    [label, f?.rp[me][k] ? 1 : 0, f?.rp[opp][k] ? 1 : 0] as const;
  return [
    [
      'AUTONOMOUS',
      [
        row('LEAVE (robots)', 'leaveCount'),
        row('LEAVE (points)', 'leave'),
        row('PARK (robots)', 'parkAutoCount'),
        row('PARK (points)', 'parkAuto'),
      ],
    ],
    ['END OF MATCH', [row('PARK (robots)', 'parkTeleCount'), row('PARK (points)', 'parkTele')]],
    [
      'HIVE',
      [
        row('TIPS (count)', 'tips'),
        row('TIPS (points)', 'tipPts'),
        row('Up CELL contents (elements)', 'cellCount'),
        // 0 for the whole match — Table 10-2 pays for what is LEFT IN the cell at the buzzer
        // (owner ruling, 2026-09-12), so the label says when the number arrives rather than
        // leaving a driver to read a permanent 0 beside a tray with four elements in it.
        row('Up CELL contents (points at the buzzer)', 'cellPts'),
      ],
    ],
    [
      'FLOWER',
      [
        row('OWNED FLOWER (elements)', 'ownedCount'),
        row('OWNED FLOWER (points)', 'ownedPts'),
        row('Bottom NECTAR Bonus (FLOWERS)', 'bottomCount'),
        row('Bottom NECTAR Bonus (points)', 'bottomPts'),
      ],
    ],
    ['GARDEN', [row('GARDEN (elements)', 'gardenCount'), row('GARDEN (points)', 'gardenPts')]],
    // points AWARDED to each alliance, i.e. earned from the OPPONENT's violations — the same
    // direction the shared breakdown prints, so the two reconcile against their totals.
    ['PENALTIES', [row('Fouls awarded (points)', 'foul')]],
    [
      'RANKING POINTS',
      [
        rp(`SWARM (${BB_RP.swarm} LEAVE + PARK points)`, 'swarm'),
        rp(`POLLINATOR 1 (${BB_RP.pollinator1} TIPS)`, 'pollinator1'),
        rp(`POLLINATOR 2 (${BB_RP.pollinator2} TIPS)`, 'pollinator2'),
      ],
    ],
  ];
}
