import type { RobotSpec, World } from '../types';
import type { GameId } from '../games/types';
import type { ControlBindings } from '../input/bindings';

/**
 * THE TUTORIAL ENGINE'S TYPES — DOM-free, so the headless smoke lane builds and drives the
 * same steps the browser does (`scripts/smoke-biobuzz/tutorial.ts`).
 *
 * A TUTORIAL IS A SCRIPTED SOLO PRACTICE: a list of STEPS, each one a staged field, a goal
 * predicate over the world, and a hint that names the keys the player has actually bound.
 * Nothing here draws, and nothing here reads a clock — the card that renders a step is
 * `src/ui/TutorialCard.tsx` and the thing that drives it is `GameController`.
 *
 * ── THE ONE RULE THAT SHAPES THIS FILE: STAGING IS WORLD CONSTRUCTION ──────────
 * `docs/area/netcode.md` states the invariant solo practice depends on — a run is fully
 * SIM-DRIVEN, so that `{seed, setups, commands}` alone reproduce it. A tutorial step that
 * teleported the robot to the HIVE halfway through a run would put a fact into the world that
 * no replay could rebuild, and solo practice is RECORDED.
 *
 * So a step never touches a world that is already running. `stage` is applied to a world that
 * has just been built, at tick 0, before the robot may move and before any recorder could
 * open — the same moment `stageBiobuzz` lays out the field. Moving to the next step REBUILDS
 * the world with a fresh seed and stages that one, exactly as `GameController.restart()` does.
 * And the tutorial deliberately runs as FREE DRIVE, which is never recorded at all (see
 * `GameController.startMatch`) — a staged world is not reconstructible from `{seed, setups}`,
 * so recording one would file a replay that plays back a different situation.
 */

/** what a hint may name — the player's own bindings, and whether a pad is in their hands. */
export interface TutorialHintCtx {
  /** the LIVE bindings, straight off `GameSettings` — never `DEFAULT_BINDINGS` */
  bindings: ControlBindings;
  /** a gamepad is connected right now ⇒ name buttons rather than keys */
  gamepad: boolean;
  /**
   * A COARSE POINTER — a phone or a tablet, driving on the on-screen pad.
   *
   * It outranks nothing and is checked LAST (a pad plugged into a tablet is still a pad), but it
   * has to be here: a hint that says "hold SHIFT" on a device with no keyboard is the exact
   * failure the binding-aware hints exist to prevent, one step further along. Measured on a
   * 375-wide emulated phone while this was being built — the card read "WASD to drive" under two
   * on-screen joysticks.
   */
  touch: boolean;
}

/**
 * A CONTROL IN A HINT — drawn as a keycap on the card (`.ds-key`), so "hold SHIFT near the
 * POLLEN" can tell the key from the manual noun when both are in capitals (design review 12-10).
 * `missing` is set, and `key` empty, when the action has no bind at all: `say` then replaces the
 * whole hint with one that says so, rather than composing a sentence around a hole.
 */
export interface HintKey {
  key: string;
  /** the spoken name, when the glyph is not one ("Left arrow" for ←) */
  name?: string;
  /** the action's name ("Shoot"), present only when it is unbound */
  missing?: string;
  /** the unbound control is a pad button rather than a key */
  pad?: boolean;
}

/** one run of a hint: prose, or a control. */
export type HintPart = string | HintKey;

/** a composed hint — build one with `say` (`./hints.ts`), flatten one with `hintText`. */
export type Hint = readonly HintPart[];

/** one step of a tutorial. */
export interface TutorialStep {
  /** stable, kebab-case. It is in the HUD card's DOM and in the smoke lane's check names, so
   * renaming one invalidates both — treat it as public. */
  id: string;
  /** the card's heading. Sentence case (`docs/area/ui.md`). */
  title: string;
  /**
   * The line under the heading, composed from the player's OWN bindings.
   *
   * A function rather than a string because the bindings are rebindable and a pad can be
   * plugged in mid-tutorial: a hint baked at module load says SPACE to somebody who moved
   * fire onto F, which is the single most confusing thing a tutorial can do.
   */
  hint(ctx: TutorialHintCtx): Hint;
  /**
   * STAGE the situation this step teaches, on a world that has just been built.
   *
   * Deterministic — no clock, no `Math.random`, no DOM (the same contract `src/games/<id>/`
   * sim code is held to, and `npm test`'s source guard greps for it). Called once, at tick 0,
   * from `GameController.makeWorld`, on the world's own robot ids.
   */
  stage?(world: World, robotId: number): void;
  /**
   * HAS THE PLAYER DONE IT? Evaluated every sim tick, so it must be cheap and it must be a
   * pure read of the world.
   *
   * ⚠️ IT MUST BE FALSE ON THE STAGED WORLD. A predicate that is already true when the step
   * opens completes instantly and teaches nothing, and the failure is invisible — the card
   * flashes past. The TUTORIAL lane asserts the staged world for every step (`none is true at
   * step start`), which is the only place that can.
   */
  done(world: World, robotId: number): boolean;
  /**
   * Seconds after which the card offers a nudge ("stuck? Skip this step"). It never SKIPS on
   * its own: a tutorial that moves on while somebody is still trying is a tutorial that
   * decided they had failed.
   */
  nudgeS?: number;
  /**
   * IS THIS STEP EVEN POSSIBLE ON THIS ROBOT? Absent ⇒ always.
   *
   * The player drives their OWN build through the tutorial, and a BIOBUZZ build without a Box
   * Tube physically cannot place a NECTAR in a FLOWER (`placeInFlower` refuses at the first
   * line). Offering a step the robot cannot complete is worse than not offering it, so the
   * step list is resolved against the spec once, when the runner is constructed, and the card
   * numbers the steps that are actually going to be asked for.
   */
  applies?(spec: RobotSpec): boolean;
}

/** one game's tutorial, hung on `GameModule.tutorial`. */
export interface TutorialSpec {
  game: GameId;
  steps: readonly TutorialStep[];
  /**
   * Applied to every step's world BEFORE that step's own `stage` — the common set-up a whole
   * tutorial wants (BIOBUZZ clears the opponent's half so nothing the player is not being
   * asked about is in the way). Same determinism contract as `stage`.
   */
  seedWorld?(world: World, robotId: number): void;
}

/** what the HUD card renders — a projection, read at the 10 Hz HUD poll. */
export interface TutorialView {
  /** 0-based, within the steps this robot is actually being asked to do */
  index: number;
  count: number;
  id: string;
  title: string;
  hint: Hint;
  /** seconds spent on this step (sim time, so a paused tab does not age it) */
  elapsedS: number;
  /** the nudge line is due */
  stuck: boolean;
  /** every step is done — the card shows the sign-off */
  finished: boolean;
}
