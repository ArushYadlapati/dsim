import type { RobotSpec } from '../../types';
import { bbDeployedHeightIn } from './config';
import { bbLauncherOf, bbLiftOf } from './mechs';

/**
 * A BUILD'S GEOMETRY IDENTITY — the fields that change what a BIOBUZZ robot LOOKS like in 3D,
 * joined into one string.
 *
 * ── WHY IT IS ITS OWN (TINY) MODULE ─────────────────────────────────────────────────────────
 * It has two readers on opposite sides of the lazy-chunk boundary:
 *
 *  - `scene/renderRobots.ts` (inside the Three.js chunk) rebuilds a robot's `THREE.Group` only
 *    when this changes, so a driving robot never pays for a teardown every frame.
 *  - `Preview3D.tsx` (the MAIN chunk) keys the saved-robot thumbnail cache on it, and has to be
 *    able to do that BEFORE — and without — loading the scene chunk.
 *
 * One function, so those two can never disagree about whether two specs are the same robot. That
 * is the concrete form of roadmap item 1's "preview and match must not drift": a thumbnail cached
 * under a key that the generator does not rebuild on would show the previous build.
 *
 * ── WHAT IS IN IT, AND WHAT IS NOT ──────────────────────────────────────────────────────────
 * POSE is not in it (position, heading, turret yaw) — that is set on the group every frame and
 * costs nothing. MASS, RPM and the hopper size are not in it either: they change how the robot
 * DRIVES, not what it is shaped like, and putting them in would throw away the group on every
 * drag of a slider that cannot change a single vertex.
 *
 * `heightIn` goes in RESOLVED (`bbDeployedHeightIn`), not raw, so an absent height and an
 * explicit 18 are one key rather than two. The STOWED preview is expressed as a spec whose
 * `heightIn` IS the stow height, which is why the stow toggle rebuilds correctly for free.
 */
export function bbSpecKey(spec: RobotSpec): string {
  const launcher = bbLauncherOf(spec, 0);
  const lift = bbLiftOf(spec);
  return [
    spec.length,
    spec.width,
    bbDeployedHeightIn(spec),
    spec.chassisColor ?? '',
    spec.intakeMount ?? '',
    spec.intake,
    spec.drivetrain,
    launcher.kind,
    launcher.mount,
    launcher.mount2 ?? '',
    lift?.mount ?? '',
  ].join('|');
}
