import type { Alliance, GameMode, RobotCommand, RobotSpec, World } from '../../src/types';
import { SIM_DT } from '../../src/config';
import { DEFAULT_ASSISTS, type RobotSetup } from '../../src/sim/spawn';
import { createBiobuzzWorld } from '../../src/games/biobuzz/spawn';
import { biobuzzStep } from '../../src/games/biobuzz/step';
import { coerceSpec } from '../../src/sim/spawn';
import { BB_DEFAULT_SPEC } from '../../src/games/biobuzz/robotConfig';
import { step3d } from '../../src/games/biobuzz/sim3d/step3d';

/**
 * The BIOBUZZ smoke harness — the `check` function and the fixtures both lane files share.
 *
 * ── WHY IT IS A SEPARATE SUITE FROM `scripts/smoke.ts` ─────────────────────
 * `smoke.ts` is 800KB of DECODE + Chain Reaction physics assertions and a RED `npm test` there
 * has one meaning: "the physics broke". A pre-Kickoff game whose numbers are all `APPROX` and
 * whose gameplay is a stub would put a second, weaker meaning on the same signal. So BIOBUZZ
 * gets its own entry point, its own pass/fail line, and its own exit code — and the lanes get
 * a file each, which is what makes two people able to add checks without touching one file.
 *
 * ── THE `check(name, ok, detail)` CONTRACT, COPIED ON PURPOSE ──────────────
 * Same shape as `smoke.ts`: it PRINTS every result, pass or fail, and counts the failures.
 * Not an assertion that throws. That is deliberate and it is the difference between "42 checks
 * ran, 1 failed, here is which" and "something threw on line 300 and the other 41 never ran" —
 * with a physics suite the second one hides regressions behind the first failure.
 *
 * `detail` carries the ACTUAL numbers, always, on failures that involve one. A containment
 * failure that says `x=73.2 > 72` is a fixed bug; one that says `false` is an afternoon.
 */
export type Check = (name: string, ok: boolean, detail?: string) => void;

/** a full `RobotCommand` from the fields a check cares about. */
export function cmd(patch: Partial<RobotCommand>): RobotCommand {
  return {
    driveX: 0,
    driveY: 0,
    rotate: 0,
    leftDrive: 0,
    rightDrive: 0,
    intake: false,
    fire: false,
    ...patch,
  };
}

/**
 * A BIOBUZZ setup with EVERY ASSIST OFF and robot-centric drive.
 *
 * `DEFAULT_ASSISTS` is field-centric, which routes a stick through
 * `viewAngleOf(alliance)` — so `driveY: 1` would drive a red robot the opposite way from a
 * blue one and the wall-containment check would test two different things per alliance. Every
 * check here wants "forward, in the robot's own frame".
 */
export function setup(
  id: number,
  alliance: Alliance,
  spec: Partial<RobotSpec> = {},
  startIndex = 0,
): RobotSetup {
  return {
    id,
    alliance,
    spec: { ...BB_DEFAULT_SPEC, ...spec },
    assists: { ...DEFAULT_ASSISTS, fieldCentric: false, aimAssist: false },
    startIndex,
  };
}

/** a BIOBUZZ world with one blue robot, the common fixture. */
export function mkWorld(mode: GameMode, seed: number, spec: Partial<RobotSpec> = {}): World {
  return createBiobuzzWorld(mode, seed, [setup(0, 'blue', spec)]);
}

/** step `seconds` of real BIOBUZZ pipeline with one command held on robot 0. */
export function run(world: World, c: RobotCommand, seconds: number): void {
  const commands = new Map([[0, c]]);
  const n = Math.round(seconds / SIM_DT);
  for (let i = 0; i < n; i++) biobuzzStep(world, SIM_DT, commands);
}

/**
 * THE FULL COERCION A BIOBUZZ SPEC ACTUALLY GETS — the shared chokepoint, and nothing else.
 *
 * It used to be `bbCoerceSpec`, a composition with a repair in the middle: the shared pass,
 * the raw mounts RE-ARMED, then this game's own pass, because `coerceSpec` had no biobuzz arm
 * and therefore wiped the two mechanism mount fields. The arm has landed
 * (`src/sim/spawn.ts`), so this is the single call it was always going to become — and every
 * check written against it kept passing unchanged, which is why they were written against
 * "the coercion a spec gets" rather than against the plumbing of the day.
 */
export function bbCoerce(raw: unknown): RobotSpec {
  return coerceSpec(raw, BB_DEFAULT_SPEC, 'biobuzz');
}

/** a BIOBUZZ world with one blue robot, staged on the 3D physics backend -- the SIM3D lane's
 * own fixture (Day 1 seam, `docs/biobuzz/plan-3d.md`). Same staging as `mkWorld`; only the
 * physics tag differs. */
export function mkWorld3d(mode: GameMode, seed: number, spec: Partial<RobotSpec> = {}): World {
  return createBiobuzzWorld(mode, seed, [setup(0, 'blue', spec)], undefined, '3d');
}

/** a BIOBUZZ 3D world with TWO robots (one per alliance) -- the SIM3D lane's 2v2-shaped and
 * capture/launch fixtures. `startIndex` 0/1 keeps the pair on opposite ends of the field, same
 * as the 2D lanes' own two-robot fixtures. */
export function mkWorld3dPair(
  mode: GameMode,
  seed: number,
  specA: Partial<RobotSpec> = {},
  specB: Partial<RobotSpec> = {},
): World {
  return createBiobuzzWorld(
    mode,
    seed,
    [setup(0, 'blue', specA, 0), setup(1, 'red', specB, 1)],
    undefined,
    '3d',
  );
}

/** step `seconds` of the real BIOBUZZ 3D pipeline with commands from `cmds` (keyed by robot id)
 * held for the whole run -- the SIM3D lane's own driver, mirroring `run()` but calling
 * `step3d` directly (the world's own `physics` tag already routes `biobuzzStep` there; this
 * skips the dispatch for lanes that want to be explicit about which pipeline they are timing). */
export function run3d(world: World, cmds: Map<number, RobotCommand>, seconds: number): void {
  const n = Math.round(seconds / SIM_DT);
  for (let i = 0; i < n; i++) step3d(world, SIM_DT, cmds);
}
