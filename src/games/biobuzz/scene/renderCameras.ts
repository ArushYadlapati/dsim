import * as THREE from 'three';
import type { SceneFrame } from '../../module';
import { BB_HALF_X, BB_VIEW_MARGIN } from '../config';

/**
 * BIOBUZZ 3D SCENE — cameras (Day 1, `docs/biobuzz/plan-3d.md` §4.3, §13.1).
 *
 * Coordinates throughout `scene/`: field INCHES, z UP (x right, y up-field, z up) — there is no
 * axis conversion anywhere in this directory. Every camera's `up` is (0,0,1).
 *
 * Both cameras are driven ENTIRELY by `frame.viewAngle`, the same angle the shared 2D camera
 * (`src/render/camera.ts`'s `Camera.worldToScreen`) rotates the world by so a driver's own wall
 * reads at the bottom of the screen: `rot(p, viewAngle)` then a y-flip, `screenUpWorld()` =
 * `rot({x:0,y:1}, -viewAngle)`. Re-deriving "which wall does this alliance's driver stand at"
 * from `frame.localRobotId`'s alliance would have to agree with that rotation anyway (BIOBUZZ's
 * 2D field renders under the exact same `Camera`), so this file takes the angle as its one input
 * and never looks up a robot — see `renderScene.ts`'s header for the consequence: a caller that
 * ever wants a viewAngle that is not a clean per-alliance one (a free spectator orbit, say) has
 * nowhere to plug that into a `SceneFrame` today. Noted as a gotcha for the integration lane.
 */

/** driver eye height, in — `BB3_EYE_DEFAULT` (plan-3d.md §13.1). */
const BB3_EYE_DEFAULT = 62;
/** how far outside the field wall the driver's eye sits, in — `BB3_DRIVER_SETBACK`. */
const BB3_DRIVER_SETBACK = 12;
/** driver camera vertical FOV, degrees — `BB3_CAM_FOV`. */
const BB3_CAM_FOV = 70;

/** unit world-space (x,y) direction "into the field" for a given screen orientation — inlined
 * copy of `Camera.screenUpWorld()`'s `rot({x:0,y:1}, -viewAngle)` (standard CCW rotation), so
 * this file needs no import from the 2D camera (which is built around a canvas context this
 * scene does not have). */
function forwardOf(viewAngle: number): { x: number; y: number } {
  const theta = -viewAngle;
  return { x: -Math.sin(theta), y: Math.cos(theta) };
}

export interface BbCameras {
  driver: THREE.PerspectiveCamera;
  overhead: THREE.OrthographicCamera;
  /** update both cameras for this frame and return the one `frame.camera` names. */
  update(frame: SceneFrame): THREE.Camera;
}

export function createCameras(): BbCameras {
  const driver = new THREE.PerspectiveCamera(BB3_CAM_FOV, 1, 1, 4000);
  driver.up.set(0, 0, 1);
  const overhead = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 4000);
  overhead.up.set(0, 0, 1);

  function updateDriver(frame: SceneFrame): void {
    const fwd = forwardOf(frame.viewAngle);
    // the field is square (BB_HALF_X === BB_HALF_Y), so one half-extent is the wall distance on
    // every side regardless of which alliance's viewAngle this frame carries
    const eyeDist = BB_HALF_X + BB3_DRIVER_SETBACK;
    driver.aspect = Math.max(1e-3, frame.width / Math.max(1, frame.height));
    driver.position.set(-fwd.x * eyeDist, -fwd.y * eyeDist, BB3_EYE_DEFAULT);
    driver.up.set(0, 0, 1);
    // look toward field centre, a little below eye height so the far wall does not fill the
    // whole frame — APPROX, a look-at-robot option is a later graphics setting (plan-3d.md §4.3)
    driver.lookAt(0, 0, BB3_EYE_DEFAULT * 0.4);
    driver.updateProjectionMatrix();
  }

  function updateOverhead(frame: SceneFrame): void {
    const fwd = forwardOf(frame.viewAngle);
    const aspect = Math.max(1e-3, frame.width / Math.max(1, frame.height));
    // fit the field plus the same view margin the 2D bounds use (`bounds.viewMargin`), in BOTH
    // screen axes — the square field means a screen-aligned fit needs no rotation-dependent math
    const half = BB_HALF_X + BB_VIEW_MARGIN;
    const halfH = aspect >= 1 ? half : half / aspect;
    const halfW = aspect >= 1 ? half * aspect : half;
    overhead.left = -halfW;
    overhead.right = halfW;
    overhead.top = halfH;
    overhead.bottom = -halfH;
    overhead.near = 1;
    overhead.far = 4000;
    overhead.position.set(0, 0, 800);
    // screen-up on the overhead view is world "forward" (into the field from the driver's own
    // wall), matching `worldToScreen`'s rotation for the 2D view
    overhead.up.set(fwd.x, fwd.y, 0);
    overhead.lookAt(0, 0, 0);
    overhead.updateProjectionMatrix();
  }

  return {
    driver,
    overhead,
    update(frame: SceneFrame): THREE.Camera {
      updateDriver(frame);
      updateOverhead(frame);
      return frame.camera === 'driver' ? driver : overhead;
    },
  };
}
