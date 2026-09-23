/**
 * THE TUTORIAL ENGINE — shared across games; the CONTENT is per game
 * (`src/games/<id>/tutorial.ts`, hung on `GameModule.tutorial`).
 *
 * Read `./types.ts` first: the one rule that shapes the whole engine is that a step's
 * situation is staged at WORLD CONSTRUCTION and never into a running world, because solo
 * practice is recorded and a replay rebuilds from `{seed, setups, commands}` alone.
 */
export { TutorialRunner } from './runner';
export { tutorialSeen, markTutorialSeen, clearTutorialSeen } from './flag';
export { control, driveHint, hintText, keyFor, padFor, say } from './hints';
export type { Hint, HintKey, HintPart, TutorialHintCtx, TutorialSpec, TutorialStep, TutorialView } from './types';
