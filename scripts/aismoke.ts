/**
 * THE AI TOURNAMENT — `npm run test:ai`. Day 3 lane A, `docs/biobuzz/plan-3d.md` §6.
 *
 * ── WHAT IT PROVES, AND WHY IT IS NOT IN `npm test` ─────────────────────────
 * That the tiers are ORDERED: HARD beats EASY in at least 90 of 100 seeded 1v1s under 3D
 * physics, and MEDIUM sits between them. That is not a unit test — it is a hundred full
 * 2:38 matches of real Rapier 3D, and it costs minutes. `npm test` has to stay fast and a red
 * `npm test` has to keep meaning "the physics broke" (CLAUDE.md), so this rides beside
 * `contrast`, `uiaudit`, `dbtest` and `test:mm` as its own command with its own exit code.
 *
 * The AI lane INSIDE `npm test` (`scripts/smoke-biobuzz/ai.ts`) proves the things that are
 * cheap and absolute — determinism, the read list, quantization, that a bot scores at all. This
 * proves the thing that is expensive and statistical.
 *
 * ── WHY A TALLY AND NOT A SCORE THRESHOLD ───────────────────────────────────
 * "Hard scores more than 90 points" would be a check on the FIELD (how many POLLEN a tuning
 * pass left reachable), not on the AI. A head-to-head tally is scale-free: retune the launcher,
 * reweigh an element, move a FLOWER, and the claim "the harder tier wins" still means the same
 * thing. The MEAN MARGIN is printed beside it because a 90/100 with a margin of 2 points and a
 * 90/100 with a margin of 40 are different programs, and only one of them survives a tuning day.
 *
 * ── SIDES ALTERNATE ─────────────────────────────────────────────────────────
 * The field is point-symmetric but the two START ANCHORS are not the same drive to the HIVE, so
 * a tally run with HARD always on blue would measure the anchors as much as the tiers. Every
 * other seed swaps them.
 *
 *   npx tsx scripts/aismoke.ts                 # the full run
 *   npx tsx scripts/aismoke.ts --seeds 20      # a quick shape check while iterating
 *   npx tsx scripts/aismoke.ts --physics 2d    # the same tally under the 2D pipeline
 */
import type { Physics } from '../src/games/types';
import type { RobotCommand, World } from '../src/types';
import { SIM_DT } from '../src/config';
import { initPhysics } from '../src/sim/physicsEngine';
import { initPhysics3d } from '../src/games/biobuzz/sim3d/engine';
import { startMatch } from '../src/sim/match';
import { DEFAULT_ASSISTS, type RobotSetup } from '../src/sim/spawn';
import { BB_DEFAULT_SPEC } from '../src/games/biobuzz/robotConfig';
import { createBiobuzzWorld } from '../src/games/biobuzz/spawn';
import { biobuzzStep } from '../src/games/biobuzz/step';
import { BIOBUZZ_BOT } from '../src/games/biobuzz/ai';

/** hard cap on a match's ticks — 158 s of phases at 60 Hz plus a wide settle margin. A guard,
 * not a budget: a phase machine that stopped advancing must fail loudly rather than hang CI. */
const MAX_TICKS = 12_000;

function seat(id: number, alliance: 'red' | 'blue', startIndex: number): RobotSetup {
  return {
    id,
    alliance,
    spec: { ...BB_DEFAULT_SPEC },
    assists: { ...DEFAULT_ASSISTS },
    startIndex,
  };
}

/**
 * one full MATCH, two seats, to the buzzer. Returns each alliance's final total.
 *
 * A tier of `'idle'` seats NO BOT at all — the robot gets no command and sits where it started.
 * That is what `--solo` measures a tier against, and it is the honest control: a head-to-head
 * tally says which tier is better, and only an idle opponent says whether either of them can
 * play at all.
 */
function playMatch(
  seed: number,
  blueTier: string,
  redTier: string,
  physics: Physics,
  blueAnchor = 0,
): { red: number; blue: number; redFoul: number; blueFoul: number; ticks: number } {
  const world: World = createBiobuzzWorld(
    'match',
    seed,
    // ONE ANCHOR EACH, and the pairing ROTATES across seeds (see `tourney`). The two anchors are
    // the TOP and BOTTOM start roles and they are not the same drive to the HIVE, so a tally that
    // pinned one tier to one of them would be measuring the anchors as much as the tiers — and
    // putting BOTH robots on the same anchor is worse still, because a point-symmetric field
    // mirrors them onto adjacent tiles and the match opens with the two chassis in contact.
    [seat(0, 'blue', blueAnchor), seat(1, 'red', blueAnchor === 0 ? 1 : 0)],
    undefined,
    physics,
  );
  startMatch(world);
  // THE SEED IS THE MATCH'S, THE SEAT IS THE ROBOT'S — plan §6's `(matchSeed, seat)`. The policy
  // mixes the id in itself, which is what keeps two seats of one match from drawing the same
  // hesitation stream.
  const bots = [
    blueTier === 'idle' ? null : BIOBUZZ_BOT.create(world, 0, blueTier, seed),
    redTier === 'idle' ? null : BIOBUZZ_BOT.create(world, 1, redTier, seed),
  ];
  const cmds = new Map<number, RobotCommand>();
  let ticks = 0;
  while (world.match.phase !== 'post' && ticks < MAX_TICKS) {
    // ONE `step` PER SEAT PER TICK, BEFORE the sim tick — the driving contract a room follows.
    if (bots[0]) cmds.set(0, bots[0].step(world));
    if (bots[1]) cmds.set(1, bots[1].step(world));
    biobuzzStep(world, SIM_DT, cmds);
    ticks++;
  }
  for (const b of bots) b?.dispose?.();
  return {
    red: world.match.scores.red.total,
    blue: world.match.scores.blue.total,
    redFoul: world.match.scores.red.foulPoints,
    blueFoul: world.match.scores.blue.foulPoints,
    ticks,
  };
}

interface Tally {
  wins: number;
  losses: number;
  draws: number;
  margin: number;
  played: number;
  ms: number;
  /** foul points each side was HANDED — i.e. what the other one gave away. Reported because it
   * is the first thing to look at when a stronger tier loses: a fast bot that pins is paying its
   * opponent 20 points at a time. */
  foulFor: number;
  foulAgainst: number;
}

/** `a` against `b` over `seeds` matches, sides alternating. `wins` are `a`'s. */
function tourney(a: string, b: string, seeds: number, physics: Physics, verbose = false): Tally {
  const t: Tally = { wins: 0, losses: 0, draws: 0, margin: 0, played: 0, ms: 0, foulFor: 0, foulAgainst: 0 };
  const t0 = Date.now();
  for (let s = 0; s < seeds; s++) {
    // FOUR-WAY ROTATION: `a` takes (blue, anchor 0), (red, anchor 1), (blue, anchor 1),
    // (red, anchor 0) in turn, so neither the SIDE nor the ANCHOR can carry the result.
    const aIsBlue = s % 2 === 0;
    const blueAnchor = s % 4 < 2 ? 0 : 1;
    const seed = 1000 + s;
    const r = playMatch(seed, aIsBlue ? a : b, aIsBlue ? b : a, physics, blueAnchor);
    const scoreA = aIsBlue ? r.blue : r.red;
    const scoreB = aIsBlue ? r.red : r.blue;
    if (scoreA > scoreB) t.wins++;
    else if (scoreA < scoreB) t.losses++;
    else t.draws++;
    t.margin += scoreA - scoreB;
    t.foulFor += aIsBlue ? r.blueFoul : r.redFoul;
    t.foulAgainst += aIsBlue ? r.redFoul : r.blueFoul;
    t.played++;
    if (verbose) console.log(`  seed ${seed} ${a}${aIsBlue ? '(blue)' : '(red)'} ${scoreA} - ${scoreB} ${b}`);
  }
  t.ms = Date.now() - t0;
  return t;
}

function readArgs(argv: string[]): { seeds: number; physics: Physics; verbose: boolean; solo: boolean } {
  const out: { seeds: number; physics: Physics; verbose: boolean; solo: boolean } = {
    seeds: 100,
    physics: '3d',
    verbose: false,
    solo: false,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--verbose') { out.verbose = true; continue; }
    if (argv[i] === '--solo') { out.solo = true; continue; }
    const eq = argv[i].indexOf('=');
    const name = eq >= 0 ? argv[i].slice(0, eq) : argv[i];
    const value = eq >= 0 ? argv[i].slice(eq + 1) : argv[++i];
    if (name === '--seeds') out.seeds = Math.max(2, Math.round(Number(value)));
    else if (name === '--physics') out.physics = value === '2d' ? '2d' : '3d';
    else {
      console.error(`[aismoke] unknown flag ${name}`);
      console.error('[aismoke] usage: aismoke [--seeds N] [--physics 2d|3d] [--verbose] [--solo]');
      process.exit(2);
    }
  }
  return out;
}

const args = readArgs(process.argv.slice(2));

await initPhysics();
if (args.physics === '3d') await initPhysics3d();

let failures = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const line = (label: string, t: Tally): string =>
  `${label}: ${t.wins}W ${t.losses}L ${t.draws}D of ${t.played}` +
  `  ·  mean margin ${(t.margin / t.played).toFixed(1)} pts` +
  `  ·  fouls handed to it ${(t.foulFor / t.played).toFixed(1)} / given away ${(t.foulAgainst / t.played).toFixed(1)}` +
  `  ·  ${(t.ms / 1000).toFixed(1)}s`;

console.log(`[aismoke] ${args.seeds} seeded 1v1s per pairing, ${args.physics} physics, sides alternating\n`);

/**
 * ---- THE SOLO CONTROL: each tier against an IDLE opponent -----------------------------------
 *
 * ⚠️ **THE HEAD-TO-HEAD TALLY ALONE CANNOT TELL "HARD IS BETTER" FROM "EASY IS BROKEN".** Nor can
 * it see a policy that has got worse, as long as both tiers got worse together — and they always
 * do, because they are the same policy. The solo control can: it reports what ONE tier scores
 * with nothing in its way, which is the number a tuning day actually moves, and it is far quieter
 * than a head-to-head because nothing is competing for the elements or leaning on the chassis.
 *
 * It is the pairing this command asserts the ORDERING on, for that reason.
 */
function solo(tier: string, seeds: number, physics: Physics, verbose: boolean): { mean: number; min: number; max: number; ms: number } {
  let total = 0;
  let min = Infinity;
  let max = -Infinity;
  const t0 = Date.now();
  for (let s = 0; s < seeds; s++) {
    const r = playMatch(1000 + s, tier, 'idle', physics);
    total += r.blue;
    min = Math.min(min, r.blue);
    max = Math.max(max, r.blue);
    if (verbose) console.log(`  seed ${1000 + s} ${tier} solo ${r.blue}`);
  }
  return { mean: total / seeds, min, max, ms: Date.now() - t0 };
}

const soloSeeds = Math.max(2, Math.round(args.seeds * 0.1));
const soloTiers = ['easy', 'medium', 'hard'].map((tier) => {
  const r = solo(tier, soloSeeds, args.physics, args.verbose);
  console.log(
    `${tier.padEnd(6)} vs idle: mean ${r.mean.toFixed(1)} pts  ·  min ${r.min}  max ${r.max}` +
      `  ·  ${(r.ms / 1000).toFixed(1)}s`,
  );
  return { tier, ...r };
});
console.log('');
if (args.solo) process.exit(0);

const hardEasy = tourney('hard', 'easy', args.seeds, args.physics, args.verbose);
console.log(line('HARD vs EASY  ', hardEasy));
// the SIDE pairings are shorter on purpose: the ordering claim they carry is "Medium is between",
// which is a majority, not the 90% the headline pairing asserts.
const half = Math.max(2, Math.round(args.seeds * 0.25));
const medEasy = tourney('medium', 'easy', half, args.physics, args.verbose);
console.log(line('MEDIUM vs EASY', medEasy));
const hardMed = tourney('hard', 'medium', half, args.physics, args.verbose);
console.log(line('HARD vs MEDIUM', hardMed));
console.log('');

/**
 * ── THE ASSERTIONS ──────────────────────────────────────────────────────────
 *
 * ⚠️ **THE HEAD-TO-HEAD WIN RATE IS A RATCHET — READ THIS BEFORE MOVING IT.** `docs/biobuzz/plan-3d.md`
 * §6 asks for HARD over EASY in 90 of 100 seeded 1v1s, and the floor only ever goes UP, the same
 * ratchet `uiaudit` and `docaudit` use: raise it when the policy improves, never lower it to make
 * a red run green.
 *
 * It sat at 0.55 for the first policy, which measured 59 wins, 40 losses and a draw at a mean
 * margin of +7.5 — a 1v1 decided in 20-point lumps on totals of 30 to 70, HARD 102.4 against an
 * idle opponent to EASY's 53.1. The 2026-09-22 rewrite (`ai/policy.ts`'s header; `npm run
 * bench:ai` is the measurement) measured, on this file's own seeds and build: HARD 216.1 / MEDIUM
 * 183.4 / EASY 109.0 against an idle opponent, and HARD over EASY **100 of 100, mean margin +90.3**.
 * So the plan's 90 % is now the floor.
 */
const BB_AI_WIN_RATE_FLOOR = 0.9;
const BB_AI_WIN_RATE_TARGET = 0.9;

const rate = hardEasy.wins / hardEasy.played;
check(
  `HARD beats EASY in at least ${(BB_AI_WIN_RATE_FLOOR * 100).toFixed(0)}% of ${hardEasy.played} seeded 1v1s` +
    ` (plan target ${(BB_AI_WIN_RATE_TARGET * 100).toFixed(0)}%)`,
  rate >= BB_AI_WIN_RATE_FLOOR,
  `${hardEasy.wins}/${hardEasy.played} = ${(rate * 100).toFixed(0)}%, mean margin ${(hardEasy.margin / hardEasy.played).toFixed(1)}`,
);
if (rate >= BB_AI_WIN_RATE_TARGET) {
  console.log(`NOTE  the plan's ${(BB_AI_WIN_RATE_TARGET * 100).toFixed(0)}% is now met — raise BB_AI_WIN_RATE_FLOOR to lock it in.`);
} else if (rate > BB_AI_WIN_RATE_FLOOR + 0.1) {
  console.log(`NOTE  the win rate has moved well clear of the floor — consider raising BB_AI_WIN_RATE_FLOOR.`);
}
check(
  'HARD beats EASY on POINTS across the run (a positive mean margin)',
  hardEasy.margin > 0,
  `mean margin ${(hardEasy.margin / hardEasy.played).toFixed(1)} pts over ${hardEasy.played} matches`,
);

// ---- THE ORDERING, on the quiet control -----------------------------------------------------
const [easySolo, medSolo, hardSolo] = soloTiers;
check(
  'the tiers are ORDERED against an idle opponent (easy < medium < hard)',
  easySolo.mean < medSolo.mean && medSolo.mean < hardSolo.mean,
  `easy ${easySolo.mean.toFixed(1)} · medium ${medSolo.mean.toFixed(1)} · hard ${hardSolo.mean.toFixed(1)}`,
);
check(
  'HARD is at least 1.5x EASY against an idle opponent',
  hardSolo.mean >= easySolo.mean * 1.5,
  `hard ${hardSolo.mean.toFixed(1)} vs easy ${easySolo.mean.toFixed(1)} (${(hardSolo.mean / Math.max(1, easySolo.mean)).toFixed(2)}x)`,
);
check(
  'MEDIUM is BETWEEN them, not level with either (at least 10% clear of both)',
  medSolo.mean >= easySolo.mean * 1.1 && medSolo.mean <= hardSolo.mean * 0.9,
  `easy ${easySolo.mean.toFixed(1)} · medium ${medSolo.mean.toFixed(1)} · hard ${hardSolo.mean.toFixed(1)}`,
);
check(
  'EVERY tier can actually score (an idle-opponent mean above zero)',
  soloTiers.every((x) => x.min > 0),
  soloTiers.map((x) => `${x.tier} min ${x.min}`).join(' · '),
);

const totalMs = hardEasy.ms + medEasy.ms + hardMed.ms;
console.log(
  `\n${hardEasy.played + medEasy.played + hardMed.played} matches in ${(totalMs / 1000).toFixed(1)}s` +
    `  (${(totalMs / (hardEasy.played + medEasy.played + hardMed.played) / 1000).toFixed(2)}s per match)`,
);
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
