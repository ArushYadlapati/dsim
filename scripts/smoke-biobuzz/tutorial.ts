import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SIM_DT } from '../../src/config';
import { rot } from '../../src/math';
import type { Alliance, Physics, RobotCommand, RobotSpec, RobotState, World } from '../../src/types';
import { DEFAULT_ASSISTS, coerceSpec, type RobotSetup } from '../../src/sim/spawn';
import { moduleFor } from '../../src/games';
import { DEFAULT_BINDINGS, cloneBindings } from '../../src/input/bindings';
import { TutorialRunner } from '../../src/tutorial/runner';
import { markTutorialSeen, tutorialSeen } from '../../src/tutorial/flag';
import { control, driveHint } from '../../src/tutorial/hints';
import type { TutorialHintCtx, TutorialSpec, TutorialStep } from '../../src/tutorial/types';
import { BIOBUZZ_TUTORIAL } from '../../src/games/biobuzz/tutorial';
import { createBiobuzzWorld } from '../../src/games/biobuzz/spawn';
import { biobuzzStep } from '../../src/games/biobuzz/step';
import { BB_DEFAULT_SPEC } from '../../src/games/biobuzz/robotConfig';
import { BB_FLOWERS, BB_GARDEN, BB_HIVE_CELL_DY, BB_HIVE_X, BB_LZ, BB_PRESETS } from '../../src/games/biobuzz/config';
import { bbCarriesNectar, bbLauncherOf, bbLiftOf } from '../../src/games/biobuzz/mechs';
import { bbFlowerInReach } from '../../src/games/biobuzz/robot';
import { bbHopperCap } from '../../src/games/biobuzz/robot';
import { DECODE_TUTORIAL } from '../../src/games/decode/tutorial';
import { createWorld as createDecodeWorld, DEFAULT_SPEC } from '../../src/sim/spawn';
import { step as decodeStep } from '../../src/sim/world';
import { robotInLaunchZone } from '../../src/sim/robot';
import { baseZone, goalCenter } from '../../src/sim/field';
import { wheelContacts } from '../../src/sim/physics';
import type { Check } from './harness';

/**
 * THE TUTORIAL LANE — roadmap item 6's verification.
 *
 * Two halves, and they fail for different reasons:
 *
 *  • THE ENGINE (`src/tutorial/`): the runner's state machine, the `applies` partition, the
 *    per-device flag, and that every hint names the PLAYER's bindings rather than the defaults.
 *    Pure, fast, no physics.
 *
 *  • THE CONTENT (`src/games/biobuzz/tutorial.ts`): every step is STAGED and then DRIVEN to
 *    completion by a scripted driver, under BOTH physics pipelines and for BOTH alliances.
 *
 * ── THE TWO CLAIMS THAT MATTER, AND WHY BOTH ARE NEEDED ───────────────────────
 * A step check that only asserted "the predicate went true" would pass for a step that was
 * ALREADY true on the staged world, and that failure is invisible in play: the card flashes
 * past and the player learns nothing. So every step is asserted twice —
 *
 *    NON-VACUOUS  `done` is FALSE on the freshly staged world; and
 *    COMPLETABLE  `done` becomes TRUE within the budget, driven by commands.
 *
 * The first one has already earned its place: the SHOOT step's predicate was
 * `contents.length > 0`, and the field stages three NECTAR in every up CELL, so it was true at
 * tick 0 for both alliances. It is `cellPollen(...) > 0` now.
 *
 * ── THE SCRIPTED DRIVER IS NOT A BOT ──────────────────────────────────────────
 * `bot.ts`'s policy plays the GAME; a tutorial step asks for one specific thing, and a policy
 * that decided to go and collect POLLEN instead would make a completable step look impossible.
 * So each step has a few lines of pursuit here. It drives HOLONOMICALLY (`driveY` forward,
 * `driveX` strafe) with the heading held, because two of the steps are staged with a mechanism
 * pointed at a FLOWER and a driver that turned toward its target would swing that mechanism off
 * it — which is exactly the bug this lane caught while it was being written.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** a section heading in the log — the suite is read as a transcript, like smoke.ts */
function section(title: string): void {
  console.log(`\n---- ${title} ${'-'.repeat(Math.max(0, 70 - title.length))}`);
}

function cmd(p: Partial<RobotCommand>): RobotCommand {
  return {
    driveX: 0,
    driveY: 0,
    rotate: 0,
    leftDrive: 0,
    rightDrive: 0,
    intake: false,
    fire: false,
    ...p,
  };
}

/**
 * The tutorial's own robot setup: the player's assists, minus the two that would answer a step
 * FOR the player.
 *
 * `autoIntake` and `autoFire` are ON for a real player by default and the tutorial does not turn
 * them off — a step still completes with them on, and they are the player's chosen difficulty.
 * They are off HERE so that what this lane proves is that the step is completable BY DRIVING,
 * which is the claim. Aim assist stays on because it is not switchable at all
 * (`coerceAssists` forces it, `docs/area/ui.md`), so a check that turned it off would be
 * measuring a configuration nobody can play.
 */
function tutorialSetup(alliance: Alliance, spec: RobotSpec): RobotSetup {
  return {
    id: 0,
    alliance,
    spec,
    assists: { ...DEFAULT_ASSISTS, fieldCentric: false, autoIntake: false, autoFire: false },
    startIndex: 0,
  };
}

/** the world the controller builds for a tutorial run: FREE DRIVE, one robot, no bots. */
function tutorialWorld(alliance: Alliance, spec: RobotSpec, physics: Physics): World {
  return createBiobuzzWorld('free', 20260918, [tutorialSetup(alliance, spec)], undefined, physics);
}

/**
 * Hold toward a world point with the HEADING UNCHANGED — see the header.
 *
 * The gain is SCALED BY DISTANCE inside the last two feet. A default build tops out at ~94 in/s,
 * so a flat full-stick pursuit of a target twelve inches away overshoots it and keeps going — in
 * DECODE that walked the robot across the field and into the OPPONENT GATE, which billed a G417
 * MAJOR and made a perfectly completable step look impossible. A driver that arrives is the point.
 */
function toward(r: RobotState, tx: number, ty: number, gain = 1): RobotCommand {
  const dx = tx - r.pos.x;
  const dy = ty - r.pos.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 0.4) return cmd({});
  gain *= Math.min(1, Math.max(0.2, d / 24));
  // robot-centric: `driveY` is forward (+x robot) and `driveX` strafes RIGHT (−y robot) —
  // `src/sim/robot.ts`'s own comment on the stick vector.
  const l = rot({ x: dx / d, y: dy / d }, -r.heading);
  return cmd({ driveY: l.x * gain, driveX: -l.y * gain });
}

/** a Box-Tube build that can also CARRY a nectar — what the `nectar` step needs, and what no
 *  shipped preset happens to be (they are all single turrets, which feed POLLEN only). */
function boxTubeSpec(): RobotSpec {
  return coerceSpec(
    {
      ...BB_DEFAULT_SPEC,
      bbMech: {
        launcher: { kind: 'dumper', mount: 'back', hoodDeg: 45 },
        lift: { kind: 'vslide', mount: 'front' },
      },
    },
    BB_DEFAULT_SPEC,
    'biobuzz',
  );
}

/** the scripted driver for one step, per tick. */
function driveFor(step: TutorialStep, world: World, r: RobotState): RobotCommand {
  const a = r.alliance;
  const sgn = a === 'blue' ? 1 : -1;
  switch (step.id) {
    case 'drive': {
      const g = BB_GARDEN[a];
      return toward(r, (g.x0 + g.x1) / 2, (g.y0 + g.y1) / 2);
    }
    case 'capture': {
      const g = BB_GARDEN[a];
      const cx = (g.x0 + g.x1) / 2;
      const cy = (g.y0 + g.y1) / 2;
      // the nearest GROUND element in the alliance's own garden corner — the staged line of four
      // plus the POLLEN the step's own staging dropped there to free a hopper slot
      const near = world.balls
        .filter((b) => b.state.kind === 'ground')
        .filter((b) => Math.abs(b.pos.x - cx) < 30 && Math.abs(b.pos.y - cy) < 24)
        .sort(
          (p, q) =>
            (p.pos.x - r.pos.x) ** 2 + (p.pos.y - r.pos.y) ** 2 -
            ((q.pos.x - r.pos.x) ** 2 + (q.pos.y - r.pos.y) ** 2),
        )[0];
      return { ...(near ? toward(r, near.pos.x, near.pos.y) : cmd({})), intake: true };
    }
    case 'shoot':
    case 'tip': {
      // close to a standoff on the up CELL's own (outboard) side and hold fire; the turret aims
      const cx = sgn * BB_HIVE_X;
      const cy = sgn * (BB_HIVE_CELL_DY + 22);
      return { ...toward(r, cx, cy, 0.6), fire: true };
    }
    case 'nectar': {
      const f = BB_FLOWERS[a === 'blue' ? 2 : 0];
      return {
        ...toward(r, f.x - sgn * 4, f.y, 0.35),
        bbPlaceNectar: bbFlowerInReach(world, r) !== null,
      } as RobotCommand;
    }
    case 'retrieve': {
      // ⚠️ NO LATERAL OFFSET HERE (owner, 2026-09-20: side rollers are `edgeGrip`, not the
      // centreline) — `mouthPoint` (`src/games/biobuzz/tutorial.ts`) already bakes the wheel's
      // own offset into the STAGED HEADING, not into the robot's position: `stageAtFlower` sets
      // `r.pos.y = FLOWER.y` exactly and rotates the chassis by the angle that puts the OFFSET
      // wheel, not the centreline, on the world-+x line back to the flower. So the drive target
      // is the SAME line the stage already put the robot on — `f.y`, unchanged — and adding a
      // lateral term here would walk the chassis OFF the heading-encoded alignment instead of
      // along it (measured: it broke the RED alliance's mirrored heading outright, never
      // completing, while blue happened to drift the other way and still passed by luck).
      const f = BB_FLOWERS[a === 'blue' ? 2 : 0];
      return { ...toward(r, f.x - sgn * 4, f.y, 0.35), intake: true };
    }
    case 'park': {
      const z = BB_LZ[a];
      return toward(r, (z.x0 + z.x1) / 2, (z.y0 + z.y1) / 2);
    }
    default:
      return cmd({});
  }
}

/** seconds of scripted driving each step gets. Every step currently completes inside 4 s of
 *  perfect driving (the slowest is the TIP, whose 4-second swing it has to wait out), so this is
 *  2× headroom — enough that a real regression fails rather than a slow tick. */
const BUDGET_S = 10;

export function tutorialChecks(check: Check): void {
  // ═══════════════════════════════════════════════════════════════════════════
  section('the seam: which games offer a tutorial');
  // ═══════════════════════════════════════════════════════════════════════════
  {
    const bb = moduleFor('biobuzz').tutorial;
    check('BIOBUZZ registers a tutorial on its module', !!bb);
    check("…and it declares itself BIOBUZZ's", bb?.game === 'biobuzz', String(bb?.game));
    // Chain Reaction has none and is not expected to; DECODE's is asserted by name so that
    // ADDING one cannot silently go unchecked, and REMOVING one is visible here.
    check(
      'Chain Reaction offers no tutorial (nothing is registered for it)',
      moduleFor('chain').tutorial === undefined,
    );
    const dec = moduleFor('decode').tutorial;
    check(
      `DECODE: ${dec ? `a tutorial with ${dec.steps.length} steps` : 'none registered'}`,
      dec === undefined || (dec.game === 'decode' && dec.steps.length > 0),
      dec ? dec.steps.map((s) => s.id).join(',') : '',
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section('the engine: the runner state machine');
  // ═══════════════════════════════════════════════════════════════════════════
  {
    const runner = new TutorialRunner(BIOBUZZ_TUTORIAL, BB_DEFAULT_SPEC);
    const n = runner.steps.length;
    check('runner: the step list is non-empty for the default build', n > 0, `${n} steps`);
    check('runner: it starts on step 0, not finished', runner.index === 0 && !runner.isFinished);
    const ctx: TutorialHintCtx = { bindings: DEFAULT_BINDINGS, gamepad: false, touch: false };
    const v0 = runner.view(ctx);
    check('runner: the view numbers the ACTIVE steps', v0.count === n && v0.index === 0, `${v0.index + 1}/${v0.count}`);
    check('runner: the view carries the step id and a composed hint', v0.id === runner.steps[0].id && v0.hint.length > 0);
    // walk it to the end
    let advances = 0;
    while (runner.advance()) advances++;
    check('runner: advance() walks every step and then reports finished', advances === n - 1 && runner.isFinished, `${advances} advances of ${n}`);
    const vEnd = runner.view(ctx);
    check('runner: the finished view says so and holds a sign-off line', vEnd.finished && vEnd.hint.length > 0, vEnd.title);
    check('runner: advance() past the end stays finished rather than throwing', runner.advance() === false);
    // STAGING IS A NO-OP ONCE FINISHED — this is what makes the last rebuild an ordinary free
    // drive rather than a seventh staged step.
    const w = tutorialWorld('blue', BB_DEFAULT_SPEC, '2d');
    const before = JSON.stringify(w);
    runner.stage(w, 0);
    check('runner: stage() on a finished tutorial changes nothing', JSON.stringify(w) === before);
  }
  {
    // the NUDGE fires on the step's own `nudgeS`, and never advances by itself
    const one: TutorialSpec = {
      game: 'biobuzz',
      steps: [{ id: 'never', title: 'Never', hint: () => 'x', done: () => false, nudgeS: 1 }],
    };
    const runner = new TutorialRunner(one, BB_DEFAULT_SPEC);
    const w = tutorialWorld('blue', BB_DEFAULT_SPEC, '2d');
    const ctx: TutorialHintCtx = { bindings: DEFAULT_BINDINGS, gamepad: false, touch: false };
    runner.stage(w, 0);
    for (let t = 0; t < 30; t++) runner.tick(w, 0);
    check('runner: not stuck before nudgeS', !runner.view(ctx).stuck, `${runner.view(ctx).elapsedS.toFixed(2)}s`);
    for (let t = 0; t < 40; t++) runner.tick(w, 0);
    const v = runner.view(ctx);
    check('runner: stuck once nudgeS has passed', v.stuck, `${v.elapsedS.toFixed(2)}s`);
    check('runner: …and it has NOT advanced on its own', runner.index === 0 && !runner.isFinished);
    runner.replay();
    check('runner: replay() resets the nudge clock', !runner.view(ctx).stuck);
  }
  {
    // a spec every step refuses ⇒ FINISHED, not broken
    const none: TutorialSpec = {
      game: 'biobuzz',
      steps: [{ id: 'nope', title: 'Nope', hint: () => 'x', done: () => true, applies: () => false }],
    };
    const runner = new TutorialRunner(none, BB_DEFAULT_SPEC);
    check(
      'runner: a spec with no applicable step is FINISHED, not a zero-step run in progress',
      runner.steps.length === 0 && runner.isFinished && runner.step === null,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section('the engine: hints name the PLAYER’s bindings');
  // ═══════════════════════════════════════════════════════════════════════════
  {
    const shoot = BIOBUZZ_TUTORIAL.steps.find((s) => s.id === 'shoot')!;
    const kb: TutorialHintCtx = { bindings: DEFAULT_BINDINGS, gamepad: false, touch: false };
    check('hint: the default fire binding renders as SPACE', shoot.hint(kb).includes('SPACE'), shoot.hint(kb));
    // REBIND IT. This is the whole reason a hint is a function of the bindings: a tutorial that
    // told a player to press a key they had moved would be worse than one with no hints at all.
    const rebound = cloneBindings(DEFAULT_BINDINGS);
    rebound.keys.fire = ['j'];
    const reb: TutorialHintCtx = { bindings: rebound, gamepad: false, touch: false };
    check('hint: a rebound fire key renders as the NEW key', shoot.hint(reb).includes('J') && !shoot.hint(reb).includes('SPACE'), shoot.hint(reb));
    // A PAD IN THEIR HANDS ⇒ name the button, not the key.
    const pad: TutorialHintCtx = { bindings: DEFAULT_BINDINGS, gamepad: true, touch: false };
    check('hint: with a pad connected it names the pad button (RT)', shoot.hint(pad).includes('RT'), shoot.hint(pad));
    check('hint: …and does not also name the key', !shoot.hint(pad).includes('SPACE'));
    // An UNBOUND action says so rather than printing `undefined`.
    const unbound = cloneBindings(DEFAULT_BINDINGS);
    unbound.keys.fire = [];
    check(
      'hint: an UNBOUND action reads "unbound", never "undefined"',
      shoot.hint({ bindings: unbound, gamepad: false, touch: false }).includes('unbound'),
      shoot.hint({ bindings: unbound, gamepad: false, touch: false }),
    );
    // the DRIVE hint: the four translation keys on a keyboard, the stick pick on a pad
    const dk = driveHint(kb);
    check('hint: the drive line names the four bound translation keys', ['W', 'A', 'S', 'D'].every((k) => dk.includes(k)), dk);
    const dp = driveHint(pad);
    check('hint: on a pad it names the chosen drive stick instead', dp.includes('left stick') && dp.includes('right stick'), dp);
    /* ⚠️ 'C', NOT 'Z': `bbPlace` shares Chain Reaction's claw key now (owner, 2026-09-22 —
       the defaults must be allowed duplicates across games, by ROLE, or they run out of keys).
       The old NAME of this check was "falls back to the key when the action has no pad twin",
       which describes a case that no longer exists at all: `bbPass` was the last action with no
       pad button and it shares L3 now, so `PAD_DEFAULT_EXEMPT` is empty and the shared suite
       asserts it. What this actually tests is that a KEYBOARD context names the key. */
    check('control(): a keyboard context names the bound KEY', control(kb, 'bbPlace') === 'C', control(kb, 'bbPlace'));
    // A PHONE HAS NO KEYBOARD. A hint that said "hold SHIFT" under two on-screen joysticks is the
    // same failure as naming an unbound key, one device further along — measured at 375px while
    // this was being built, which is why `touch` is in the context at all.
    const touch: TutorialHintCtx = { bindings: DEFAULT_BINDINGS, gamepad: false, touch: true };
    check('hint: on touch the fire control is the on-screen SHOOT button', shoot.hint(touch).includes('SHOOT') && !shoot.hint(touch).includes('SPACE'), shoot.hint(touch));
    check('hint: on touch the drive line names the sticks, not WASD', driveHint(touch).includes('stick') && !driveHint(touch).includes('W’’'.slice(0, 1) + 'ASD'), driveHint(touch));
    check('hint: a PAD still wins over touch (a pad on a tablet is what is in their hands)', shoot.hint({ bindings: DEFAULT_BINDINGS, gamepad: true, touch: true }).includes('RT'));
    // and the PARK clause, which names a key with no on-screen button, is DROPPED on touch
    const park = BIOBUZZ_TUTORIAL.steps.find((s) => s.id === 'park')!;
    check('hint: the PARK key clause is dropped on touch (there is no on-screen PARK button)', !park.hint(touch).includes(' P ') && park.hint(kb).includes('P '), park.hint(touch));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section('the engine: the per-device flag, and the source rules');
  // ═══════════════════════════════════════════════════════════════════════════
  {
    // NODE HAS NO `localStorage`, which is exactly the fail-open case: a read that throws must
    // answer "not seen" (so the offer appears) and a write that throws must not propagate.
    check('flag: tutorialSeen() is false where storage is unavailable (fail-open)', tutorialSeen() === false);
    let threw = false;
    try {
      markTutorialSeen();
    } catch {
      threw = true;
    }
    check('flag: markTutorialSeen() swallows a storage failure', !threw);
  }
  {
    /**
     * `src/tutorial/` IS NOT UNDER `smoke.ts`'s DETERMINISM GUARD, which only walks `src/sim`
     * and `src/games`. The staging functions it runs are held to the same contract — they are
     * applied to a world at tick 0 and a world has to be reproducible — so the rule is asserted
     * here instead of being assumed.
     */
    const files = readdirSync(join(root, 'src/tutorial')).filter((f) => f.endsWith('.ts'));
    const bad: string[] = [];
    for (const f of files) {
      readFileSync(join(root, 'src/tutorial', f), 'utf8')
        .split(/\r?\n/)
        .forEach((line, i) => {
          const code = line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
          if (/\bMath\.random\s*\(|\bDate\.now\s*\(|\bnew Date\s*\(|performance\.now\s*\(/.test(code)) {
            bad.push(`${f}:${i + 1}`);
          }
        });
    }
    check('src/tutorial/ reads no clock and no Math.random — a staged world must be reproducible', bad.length === 0, bad.join(', '));
    // and the ENGINE must not import a game: content lives behind the module slot
    const leaks: string[] = [];
    for (const f of files) {
      const src = readFileSync(join(root, 'src/tutorial', f), 'utf8');
      for (const m of src.matchAll(/from\s+'([^']+)'/g)) {
        if (m[1].includes('games/') && !m[1].endsWith('games/types')) leaks.push(`${f} → ${m[1]}`);
      }
    }
    check('src/tutorial/ imports no game module (content hangs off the slot, not the engine)', leaks.length === 0, leaks.join(', '));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section('BIOBUZZ content: the step list and the applies partition');
  // ═══════════════════════════════════════════════════════════════════════════
  {
    const steps = BIOBUZZ_TUTORIAL.steps;
    const ids = steps.map((s) => s.id);
    check('steps: ids are unique', new Set(ids).size === ids.length, ids.join(','));
    check('steps: ids are kebab-case', ids.every((i) => /^[a-z][a-z0-9-]*$/.test(i)), ids.join(','));
    // `docs/area/ui.md`: sentence case for every heading, and no full stop on a title.
    const caseBad = steps.filter((s) => !/^[A-Z][^.]*$/.test(s.title));
    check('steps: titles are sentence case with no full stop (docs/area/ui.md)', caseBad.length === 0, caseBad.map((s) => s.title).join(' | '));
    const kb: TutorialHintCtx = { bindings: DEFAULT_BINDINGS, gamepad: false, touch: false };
    const hintBad = steps.filter((s) => {
      const h = s.hint(kb);
      return h.length < 12 || !h.endsWith('.');
    });
    check('steps: every hint is a sentence and ends with a full stop', hintBad.length === 0, hintBad.map((s) => s.id).join(','));
    // no ASCII apostrophes or three-dot ellipses in player-facing copy
    const punct = steps.filter((s) => /'|\.\.\./.test(s.title + s.hint(kb)));
    check('steps: typographic punctuation only (’ and …)', punct.length === 0, punct.map((s) => s.id).join(','));
  }
  {
    /**
     * THE `applies` PARTITION. The two FLOWER steps are complementary by construction, and this
     * is the check that keeps them that way: every build must be offered EXACTLY ONE of them.
     * Offered both, a player does the FLOWER twice; offered neither, the tutorial silently drops
     * a step from its own count.
     */
    const specs: { name: string; spec: RobotSpec }[] = [
      ...BB_PRESETS.map((s) => ({ name: s.name, spec: s })),
      { name: 'box-tube dumper', spec: boxTubeSpec() },
    ];
    let bad = 0;
    for (const { name, spec } of specs) {
      const offered = new TutorialRunner(BIOBUZZ_TUTORIAL, spec).steps.map((s) => s.id);
      const flower = offered.filter((i) => i === 'nectar' || i === 'retrieve');
      if (flower.length !== 1) {
        bad++;
        check(`applies: ${name} is offered exactly one FLOWER step`, false, flower.join(','));
      }
    }
    check(
      `applies: all ${specs.length} builds are offered exactly one FLOWER step`,
      bad === 0,
      `${specs.length} builds`,
    );
    const bt = boxTubeSpec();
    check('applies: a Box Tube that can carry NECTAR gets the PLACE step', new TutorialRunner(BIOBUZZ_TUTORIAL, bt).steps.some((s) => s.id === 'nectar'));
    check('applies: …and that build really has both pieces of hardware', !!bbLiftOf(bt) && bbCarriesNectar(bbLauncherOf(bt, 0)));
    check('applies: the default build (single turret, no tube) gets the RETRIEVE step', new TutorialRunner(BIOBUZZ_TUTORIAL, BB_DEFAULT_SPEC).steps.some((s) => s.id === 'retrieve'));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section('BIOBUZZ content: every step staged, non-vacuous and completable');
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // BOTH PHYSICS and BOTH ALLIANCES. The alliances are not a formality on this field: it is
  // POINT-symmetric, so every pose in `tutorial.ts` is written once for blue and mirrored, and a
  // step written with an x-mirror instead would be staged on the wrong half for red — internally
  // consistent and wrong, which is the failure `bbMirror`'s own header warns about.
  for (const physics of ['2d', '3d'] as const) {
    for (const alliance of ['blue', 'red'] as const) {
      for (const spec of [BB_DEFAULT_SPEC, boxTubeSpec()]) {
        const runner = new TutorialRunner(BIOBUZZ_TUTORIAL, spec);
        for (const step of runner.steps) {
          const tag = `${step.id} (${physics}, ${alliance}, ${bbLiftOf(spec) ? 'box tube' : 'default'})`;
          const w = tutorialWorld(alliance, spec, physics);
          const ballsBefore = w.balls.length;
          BIOBUZZ_TUTORIAL.seedWorld?.(w, 0);
          step.stage?.(w, 0);
          // CONSERVATION. `world.balls` is this game's one conservation authority, so staging may
          // MOVE an element between states but never create or destroy one.
          check(`stage: ${tag} conserves world.balls`, w.balls.length === ballsBefore, `${ballsBefore} → ${w.balls.length}`);
          check(`stage: ${tag} is NON-VACUOUS (done is false at tick 0)`, !step.done(w, 0));
          const r0 = w.robots[0]!;
          const posOk = Number.isFinite(r0.pos.x) && Number.isFinite(r0.pos.y) && Math.abs(r0.pos.x) < 71 && Math.abs(r0.pos.y) < 71;
          check(`stage: ${tag} seats the robot inside the field`, posOk, `${r0.pos.x.toFixed(1)},${r0.pos.y.toFixed(1)}`);

          let at = -1;
          const ticks = Math.round(BUDGET_S / SIM_DT);
          for (let t = 0; t < ticks; t++) {
            const r = w.robots[0]!;
            biobuzzStep(w, SIM_DT, new Map([[0, driveFor(step, w, r)]]));
            if (step.done(w, 0)) {
              at = t;
              break;
            }
          }
          check(
            `drive: ${tag} completes within ${BUDGET_S}s of scripted driving`,
            at >= 0,
            at >= 0 ? `${(at * SIM_DT).toFixed(1)}s` : 'never',
          );
          // and the robot survived it: a staged pose overlapping a static explodes the solve, and
          // the symptom is a position in the thousands rather than an exception.
          const rEnd = w.robots[0]!;
          check(
            `drive: ${tag} leaves the robot on the field`,
            Number.isFinite(rEnd.pos.x) && Math.abs(rEnd.pos.x) < 80 && Math.abs(rEnd.pos.y) < 80,
            `${rEnd.pos.x.toFixed(1)},${rEnd.pos.y.toFixed(1)}`,
          );
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section('DECODE content: every step staged, non-vacuous and completable');
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // ⚠️ DECODE CHECKS IN THE BIOBUZZ SUITE, and it is a deliberate exception with a precedent:
  // `sponsor.ts` rides this suite for the same reason. `scripts/smoke.ts` is SHARDED across
  // processes by `smokeshard.mjs`, which parses it and deals its top-level blocks out — so a new
  // block there wants a cost-table recalibration and a careful read of the no-shared-state rule,
  // for four checks that belong beside the engine they exercise. The TUTORIAL lane is one
  // feature's lane, not one game's.
  //
  // DECODE's field is a REFLECTION in x (not point-symmetric like BIOBUZZ's), and its LAUNCH ZONE
  // spans the whole far half rather than belonging to a side, so both alliances are driven here
  // too — a pose written with the wrong mirror lands on the opponent's half.
  {
    const dec = DECODE_TUTORIAL;
    const ids = dec.steps.map((s) => s.id);
    check('DECODE: ids are unique and kebab-case', new Set(ids).size === ids.length && ids.every((i) => /^[a-z][a-z0-9-]*$/.test(i)), ids.join(','));
    const kb: TutorialHintCtx = { bindings: DEFAULT_BINDINGS, gamepad: false, touch: false };
    check(
      'DECODE: titles are sentence case, hints are sentences with typographic punctuation',
      dec.steps.every((s) => /^[A-Z][^.]*$/.test(s.title) && s.hint(kb).endsWith('.') && !/'|\.\.\./.test(s.hint(kb))),
      dec.steps.map((s) => s.title).join(' | '),
    );

    for (const alliance of ['blue', 'red'] as const) {
      for (const step of new TutorialRunner(dec, DEFAULT_SPEC).steps) {
        const tag = `${step.id} (decode, ${alliance})`;
        const w = createDecodeWorld('free', 20260918, [tutorialSetup(alliance, { ...DEFAULT_SPEC })]);
        const ballsBefore = w.balls.length;
        step.stage?.(w, 0);
        check(`stage: ${tag} conserves world.balls`, w.balls.length === ballsBefore, `${ballsBefore} \u2192 ${w.balls.length}`);
        check(`stage: ${tag} is NON-VACUOUS (done is false at tick 0)`, !step.done(w, 0));
        let at = -1;
        const ticks = Math.round(BUDGET_S / SIM_DT);
        const g = goalCenter(alliance);
        const bz = baseZone(alliance);
        // the artifact the INTAKE step is driven at: the nearest one on the tiles to the staged
        // pose, which is the one a player would reach for too.
        const r0 = w.robots[0]!;
        const intakeTarget =
          w.balls
            .filter((b) => b.state.kind === 'ground')
            .sort(
              (p, q) =>
                (p.pos.x - r0.pos.x) ** 2 + (p.pos.y - r0.pos.y) ** 2 -
                ((q.pos.x - r0.pos.x) ** 2 + (q.pos.y - r0.pos.y) ** 2),
            )[0]?.id ?? null;
        for (let t = 0; t < ticks; t++) {
          const r = w.robots[0]!;
          let c: RobotCommand;
          if (step.id === 'drive') c = toward(r, 0, 30);
          else if (step.id === 'intake') {
            // ONE target, chosen at STAGE time and then chased by id. Re-picking "whatever is
            // nearest this tick" made the driver hop between the loading-zone row and the preload
            // this step put down, and each hop restarted the approach — it never arrived.
            const b = intakeTarget === null ? undefined : w.balls.find((x) => x.id === intakeTarget);
            c = { ...(b ? toward(r, b.pos.x, b.pos.y) : cmd({})), intake: true };
          } else if (step.id === 'score') c = cmd({ fire: true });
          else c = toward(r, (bz.x0 + bz.x1) / 2, (bz.y0 + bz.y1) / 2);
          decodeStep(w, SIM_DT, new Map([[0, c]]));
          if (step.done(w, 0)) {
            at = t;
            break;
          }
        }
        check(
          `drive: ${tag} completes within ${BUDGET_S}s of scripted driving`,
          at >= 0,
          at >= 0 ? `${(at * SIM_DT).toFixed(1)}s` : `never (launchZone=${robotInLaunchZone(w.robots[0]!)}, classified=${w.goals[alliance].classifiedCount}, wheelsInBase=${wheelContacts(w.robots[0]!).filter((p) => p.x > bz.x0 && p.x < bz.x1 && p.y > bz.y0 && p.y < bz.y1).length}, goal=${g.x.toFixed(0)},${g.y.toFixed(0)})`,
        );
        // A TUTORIAL MUST NOT HAND OUT FOULS. DECODE's penalty engine runs in `freeplay`
        // (`src/sim/penalties.ts` says so in as many words), unlike BIOBUZZ's — so a step staged
        // in the gate zone or leaning on a structure could bill the player for doing as they were
        // told, in the one mode where nothing they do is meant to count against them.
        const f = w.match.fouls[alliance];
        check(`drive: ${tag} bills no foul against the player`, f.minor === 0 && f.major === 0, `${f.minor} minor, ${f.major} major`);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  section('BIOBUZZ content: staging is deterministic');
  // ═══════════════════════════════════════════════════════════════════════════
  {
    // Two worlds of the same seed, staged the same way, must be byte-identical: staging runs at
    // tick 0 of a world a replay would have to rebuild, so a draw from a clock or from
    // `Math.random` here would make a tutorial step a thing that cannot be reproduced.
    const runner = new TutorialRunner(BIOBUZZ_TUTORIAL, BB_DEFAULT_SPEC);
    let diff = '';
    for (const step of runner.steps) {
      const a = tutorialWorld('blue', BB_DEFAULT_SPEC, '2d');
      const b = tutorialWorld('blue', BB_DEFAULT_SPEC, '2d');
      step.stage?.(a, 0);
      step.stage?.(b, 0);
      if (JSON.stringify(a) !== JSON.stringify(b)) diff = step.id;
    }
    check('stage: two worlds of one seed stage identically', diff === '', diff);
  }
  {
    // and the HOPPER MIRROR holds: `r.hopper` is the colour list that mirrors every `held` ball
    // pointing at that robot, and a staging that drops one without the other leaves a pip the
    // driver can never fire (`stageBiobuzz`'s own note).
    const specs = [BB_DEFAULT_SPEC, boxTubeSpec()];
    let bad = '';
    for (const spec of specs) {
      for (const step of new TutorialRunner(BIOBUZZ_TUTORIAL, spec).steps) {
        for (const alliance of ['blue', 'red'] as const) {
          const w = tutorialWorld(alliance, spec, '2d');
          step.stage?.(w, 0);
          const r = w.robots[0]!;
          const held = w.balls.filter((b) => b.state.kind === 'held' && b.state.robot === r.id);
          if (held.length !== r.hopper.length) bad = `${step.id}/${alliance}: held ${held.length} vs hopper ${r.hopper.length}`;
          if (r.hopper.length > bbHopperCap(spec)) bad = `${step.id}/${alliance}: hopper over cap`;
          // a `held` ball with no local offset is the NaN that reaches Rapier as a collider
          // translation — see `giveNectar`'s header.
          for (const b of held) {
            if (b.state.kind === 'held' && (!Number.isFinite(b.state.lx) || !Number.isFinite(b.state.ly))) {
              bad = `${step.id}/${alliance}: held ball ${b.id} has no lx/ly`;
            }
          }
        }
      }
    }
    check('stage: the hopper mirrors the held set, under the cap, with finite offsets', bad === '', bad);
  }
}
