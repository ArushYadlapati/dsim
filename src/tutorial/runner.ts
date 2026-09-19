import { SIM_DT } from '../config';
import type { RobotSpec, World } from '../types';
import type { TutorialHintCtx, TutorialSpec, TutorialStep, TutorialView } from './types';

/** the default nudge delay, in seconds, for a step that names none. */
const DEFAULT_NUDGE_S = 45;

/**
 * THE TUTORIAL STATE MACHINE. DOM-free, clock-free, and owned by whoever is stepping the
 * world — `GameController` in the browser, the TUTORIAL smoke lane headlessly.
 *
 * It holds three things and nothing else: which step is current, how many ticks it has been
 * current for, and whether the whole thing is finished. It does not build worlds, does not
 * rebuild them, and does not know what a HUD is. The caller owns all three, because the caller
 * is the only thing that knows how a world is made in its context.
 *
 * ── THE CONTRACT WITH THE CALLER, IN ORDER ────────────────────────────────────
 *   1. construct the runner with the game's spec and the player's robot spec;
 *   2. build a world, and call `stage(world, robotId)` on it BEFORE the first step;
 *   3. once per sim tick, AFTER stepping, call `tick(world, robotId)`;
 *   4. when `tick` returns true (or the player pressed Skip ⇒ `advance()`), REBUILD the world
 *      and stage it again — step 2.
 *
 * Step 4 is the replay invariant (`./types.ts`): a step's situation is put into a world at
 * construction, never into one that is running.
 */
export class TutorialRunner {
  /** the steps this robot is actually being asked to do — `applies` resolved once, here, so
   * the card can number them honestly (`Step 3 of 5`, not `Step 3 of 6 (one skipped)`). */
  readonly steps: readonly TutorialStep[];
  private readonly spec: TutorialSpec;
  private i = 0;
  private ticks = 0;
  private done = false;

  constructor(spec: TutorialSpec, robotSpec: RobotSpec) {
    this.spec = spec;
    this.steps = spec.steps.filter((s) => s.applies?.(robotSpec) ?? true);
    // a spec whose every step was filtered out is FINISHED rather than broken: the caller
    // gets a plain free drive and the flag is set, which is the honest outcome of "there is
    // nothing this robot can be taught here".
    this.done = this.steps.length === 0;
  }

  get index(): number {
    return this.i;
  }

  get step(): TutorialStep | null {
    return this.done ? null : (this.steps[this.i] ?? null);
  }

  get isFinished(): boolean {
    return this.done;
  }

  /**
   * Apply the current step's situation to a freshly built world.
   *
   * `seedWorld` first, then the step's own `stage`, so a step overrides the tutorial-wide
   * set-up rather than fighting it. A no-op once the tutorial is finished, which is what makes
   * the final rebuild an ordinary free drive.
   */
  stage(world: World, robotId: number): void {
    const s = this.step;
    if (!s) return;
    this.spec.seedWorld?.(world, robotId);
    s.stage?.(world, robotId);
    this.ticks = 0;
  }

  /**
   * ONE SIM TICK. Returns true on the tick the current step's predicate first goes true —
   * once, and never again for that step, because the caller is about to replace the world.
   *
   * Evaluated per TICK rather than at the 10 Hz HUD poll on purpose: `hives[a].contents` is
   * emptied by the tip that follows it and `spill` tags clear on first contact, so a predicate
   * read six ticks late can read a situation that has already been cleaned up.
   */
  tick(world: World, robotId: number): boolean {
    const s = this.step;
    if (!s) return false;
    this.ticks++;
    return s.done(world, robotId);
  }

  /**
   * Move on — from a completed step or from Skip; the runner does not distinguish, because
   * the world is rebuilt either way and a skipped step is not a failed one.
   *
   * Returns true when there is a next step to stage, false when the tutorial has just
   * finished (the caller then rebuilds into a plain practice and sets the device flag).
   */
  advance(): boolean {
    if (this.done) return false;
    this.i++;
    this.ticks = 0;
    if (this.i >= this.steps.length) {
      this.i = this.steps.length;
      this.done = true;
      return false;
    }
    return true;
  }

  /** replay THIS step: nothing about the runner changes, the caller just rebuilds and
   * re-stages. It exists as a method so the tick counter (and therefore the nudge) resets. */
  replay(): void {
    this.ticks = 0;
  }

  /**
   * ABANDON the rest — Exit. The caller rebuilds into a plain practice.
   *
   * Named `abandon` and not `finish` on purpose: `npm test` has a source check over
   * `src/game.ts` that counts `.finish()` calls and requires exactly one, because the REPLAY
   * RECORDER may only be closed inside `harvestPracticeRun` — a second call site is a second save
   * policy. A `finish()` here would read as that second call site to a grep, and the grep is the
   * check. It is a better name anyway: the tutorial is not finished, it is being left.
   */
  abandon(): void {
    this.done = true;
    this.i = this.steps.length;
  }

  /** what the HUD card renders. Called at the 10 Hz poll; allocates one small object. */
  view(ctx: TutorialHintCtx): TutorialView {
    const s = this.step;
    const elapsedS = this.ticks * SIM_DT;
    if (!s) {
      return {
        index: this.steps.length,
        count: this.steps.length,
        id: 'done',
        title: 'Tutorial complete',
        hint: 'Free drive from here — the field is yours.',
        elapsedS,
        stuck: false,
        finished: true,
      };
    }
    return {
      index: this.i,
      count: this.steps.length,
      id: s.id,
      title: s.title,
      hint: s.hint(ctx),
      elapsedS,
      stuck: elapsedS >= (s.nudgeS ?? DEFAULT_NUDGE_S),
      finished: false,
    };
  }
}
