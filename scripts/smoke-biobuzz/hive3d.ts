import type { Check } from './harness';
import { mkWorld3d } from './harness';
import { step3d } from '../../src/games/biobuzz/sim3d/step3d';
import { engineFor, trayTilt } from '../../src/games/biobuzz/sim3d/engine';
import {
  __setHiveDynamicOverrideForTests,
  hiveCellLocalBox,
  hivePivotX,
  hiveTrayComW,
  hiveTrayMassProps,
  useHiveDynamic,
} from '../../src/games/biobuzz/sim3d/bodies';
import { hiveContentsTorque, hiveHoldTorque, hiveTiltAngle, insideCell } from '../../src/games/biobuzz/sim3d/hive3d';
import { rotate2 } from '../../src/games/biobuzz/sim3d/math3';
import {
  BB3_HIVE_BALLAST,
  BB3_HIVE_DAMPING,
  BB3_HIVE_DETENT,
  BB3_HIVE_DYNAMIC,
  BB3_HIVE_PIVOT_Z,
  BB3_HIVE_REST_W,
  BB3_HIVE_STOP_DEG,
  BB3_HIVE_TRAY_MASS,
  BB_HIVE_OPEN_Z,
  BB_HIVE_TILT_DEG,
  BB_NECTAR_R,
  BB_POLLEN_R,
} from '../../src/games/biobuzz/config';
import { BB_TIP_SWING_S } from '../../src/games/biobuzz/hive';
import type { Alliance, Artifact, World } from '../../src/types';

/**
 * HIVE3D — the DYNAMIC SEE-SAW (Day 2 lane A, `docs/biobuzz/plan-3d.md` §9).
 *
 * The plan's lane spec: "tray angle matches manual heights at ±30°; open-face shot taken, each
 * closed face bounces; table rows 8/0 and 3/3 tip, 7/0 does not; a swing empties the tray and
 * every element lands within 1.0 s; G409 tag with and without a robot under".
 *
 * ⚠️ **THE LOAD TABLE RUNS UNDER BOTH TRAYS, AND THAT IS THE POINT OF THE LANE.** The kinematic
 * tray is the plan's own fallback (§3.6, §11) and a fallback nothing exercises is a fallback that
 * has already rotted. `__setHiveDynamicOverrideForTests` builds a world on either tray from the
 * same fixtures, so flipping `BB3_HIVE_DYNAMIC` back is a one-word change that stays proven —
 * which is what makes it a real escape hatch rather than a comment about one.
 */

const REST_RAD = (BB_HIVE_TILT_DEG * Math.PI) / 180;
const STOP_RAD = (BB3_HIVE_STOP_DEG * Math.PI) / 180;
const A: Alliance = 'blue';

/** run `fn` with the tray model forced either way, and always put the override back. */
function withTray<T>(dynamic: boolean, fn: () => T): T {
  __setHiveDynamicOverrideForTests(dynamic);
  try {
    return fn();
  } finally {
    __setHiveDynamicOverrideForTests(null);
  }
}

/** the world point of a tray-local `(x, v, w)` at tilt `theta` — the same mapping `derive.ts`
 * inverts, so a fixture staged with it is staged where the engine thinks the cell is. */
function cellPoint(alliance: Alliance, theta: number, x: number, v: number, w: number): { x: number; y: number; z: number } {
  const { a: y, b: z } = rotate2(v, w, theta);
  return { x: hivePivotX(alliance) + x, y, z: BB3_HIVE_PIVOT_Z + z };
}

/** stage `pollen` + `nectar` against the up cell's back wall, in a line — §12.3's own words, and
 * the same staging `scripts/hive-calibrate.ts` fits the constants against. */
function fillCell(w: World, pollen: number, nectar: number): number[] {
  const theta = hiveTiltAngle(w, A);
  const side: 1 | -1 = w.biobuzz!.hives[A].up === 'north' ? 1 : -1;
  const box = hiveCellLocalBox(side, A);
  const innerV = side > 0 ? box.vMin : box.vMax;
  const ids: number[] = [];
  let i = 0;
  const put = (isNectar: boolean): void => {
    const r = isNectar ? BB_NECTAR_R : BB_POLLEN_R;
    const col = i % 4;
    const row = Math.floor(i / 4);
    const p = cellPoint(A, theta, (col - 1.5) * 4.6, innerV + side * (r + 0.2 + row * 3.4), box.wMin + r + 0.2);
    ids.push(i + 1);
    w.balls.push({
      id: i + 1,
      color: isNectar ? 'blue' : 'yellow',
      state: { kind: 'ground' },
      pos: { x: p.x, y: p.y },
      vel: { x: 0, y: 0 },
      z: p.z - r,
      vz: 0,
      r,
    } as Artifact);
    i++;
  };
  for (let k = 0; k < nectar; k++) put(true);
  for (let k = 0; k < pollen; k++) put(false);
  return ids;
}

function loaded(seed: number, pollen: number, nectar: number): { world: World; ids: number[] } {
  const w = mkWorld3d('free', seed);
  w.balls.length = 0;
  return { world: w, ids: fillCell(w, pollen, nectar) };
}

export function hive3dChecks(check: Check): void {
  // ---- the model, reported ------------------------------------------------------------------
  {
    const props = hiveTrayMassProps(A);
    console.log(
      `[smoke-bb hive3d] tray: ${BB3_HIVE_TRAY_MASS} lb + ${BB3_HIVE_BALLAST} lb ballast, cells ${hiveTrayComW(A).toFixed(2)} above the pivot, ` +
        `net CoM ${props.comW.toFixed(3)}, inertia ${props.inertia.toFixed(0)}; detent ${BB3_HIVE_DETENT}, damping ${BB3_HIVE_DAMPING}`,
    );
    check(
      `the DYNAMIC see-saw is the shipped tray (BB3_HIVE_DYNAMIC ${BB3_HIVE_DYNAMIC})`,
      BB3_HIVE_DYNAMIC === useHiveDynamic(),
      `constant ${BB3_HIVE_DYNAMIC}, reader ${useHiveDynamic()}`,
    );
    /**
     * THE BI-STABILITY IS THE TRAY'S SHAPE, ASSERTED DIRECTLY. Its centre of mass has to be ABOVE
     * the pivot or the whole mechanism is a different one: a see-saw with its mass below the
     * hinge hangs level and has no stable stops at all, so nothing would hold a loaded cell up
     * and §9.6's "bi-stable" would be a term the sim does not have.
     */
    check(
      'bi-stable by construction: the tray + ballast centre of mass is ABOVE the pivot',
      props.comW > 0,
      `net comW ${props.comW.toFixed(3)} (cells ${hiveTrayComW(A).toFixed(3)}, ballast pulls it down)`,
    );
  }

  // ---- the manual's own heights at ±30° -----------------------------------------------------
  //
  // Fig 9-10 prints the up-CELL opening at 53.5 … 65.6 above the tiles and the CAD measures
  // 53.375 … 65.497 (`BB_HIVE_OPEN_Z`, the generated figure). That is a statement about the TRAY
  // AT ITS STOP, so it is a statement about this angle — and it is the check that says the
  // dynamic body is seated where the kinematic one was rather than merely near it.
  for (const dynamic of [true, false]) {
    withTray(dynamic, () => {
      const w = mkWorld3d('free', dynamic ? 810 : 811);
      step3d(w, 1 / 60, new Map());
      const theta = hiveTiltAngle(w, A);
      const side: 1 | -1 = w.biobuzz!.hives[A].up === 'north' ? 1 : -1;
      const box = hiveCellLocalBox(side, A);
      const mouthV = side > 0 ? box.vMax : box.vMin;
      const lo = cellPoint(A, theta, 0, mouthV, box.wMin).z;
      const hi = cellPoint(A, theta, 0, mouthV, box.wMax).z;
      const label = dynamic ? 'dynamic' : 'kinematic';
      check(
        `[${label}] the tray rests at ${BB_HIVE_TILT_DEG}deg`,
        Math.abs(Math.abs(theta) - REST_RAD) < 2e-3,
        `theta ${((theta * 180) / Math.PI).toFixed(3)}deg`,
      );
      check(
        `[${label}] the up-CELL mouth is at the manual's own heights (BB_HIVE_OPEN_Z)`,
        Math.abs(lo - BB_HIVE_OPEN_Z[0]) < 0.1 && Math.abs(hi - BB_HIVE_OPEN_Z[1]) < 0.1,
        `mouth ${lo.toFixed(3)}..${hi.toFixed(3)} vs ${BB_HIVE_OPEN_Z[0]}..${BB_HIVE_OPEN_Z[1]}`,
      );
    });
  }

  // ---- the load table, under BOTH trays -----------------------------------------------------
  //
  // The dynamic tray does not read `BB_TIP_POLLEN` at all — it tips when the load out-torques
  // the hold — so this is the check that says the two models AGREE on the field guide's §12.3
  // acceptance rows. Under the kinematic tray it is the table itself being read.
  {
    const rows: readonly [number, number, boolean][] = [
      [7, 0, false],
      [8, 0, true],
      [2, 3, false],
      [3, 3, true],
    ];
    for (const dynamic of [true, false]) {
      withTray(dynamic, () => {
        const label = dynamic ? 'dynamic' : 'kinematic';
        for (const [pollen, nectar, expect] of rows) {
          const { world } = loaded(820 + pollen * 7 + nectar + (dynamic ? 0 : 100), pollen, nectar);
          const startUp = world.biobuzz!.hives[A].up;
          for (let t = 0; t < 900; t++) step3d(world, 1 / 60, new Map());
          const tipped = world.biobuzz!.hives[A].up !== startUp;
          check(
            `[${label}] load table: ${pollen}p+${nectar}n ${expect ? 'TIPS' : 'does NOT tip'} (field guide §12.3)`,
            tipped === expect,
            `tipped=${tipped}`,
          );
        }
      });
    }
  }

  // ---- the swing: 4.0 s stop to stop, and the tray empties within 1.0 s ---------------------
  if (BB3_HIVE_DYNAMIC) {
    const { world, ids } = loaded(840, 8, 0);
    const e = engineFor(world);
    const body = e.hiveTrays[A];
    const sign = world.biobuzz!.hives[A].up === 'north' ? 1 : -1;
    let left = -1;
    let arrived = -1;
    let emptied = -1;
    /** per element: the tick it stopped being inside a cell, and the tick it first reached the
     * tiles at rest. `landed − leftCell` is the FALL, which is what the plan's 1.0 s is about. */
    const leftCell = new Map<number, number>();
    const landed = new Map<number, number>();
    for (let t = 0; t < 900; t++) {
      step3d(world, 1 / 60, new Map());
      const th = trayTilt(body);
      const om = body.angvel().x;
      if (left < 0 && Math.abs(th) < STOP_RAD) left = t;
      if (left >= 0 && arrived < 0 && Math.abs(th) >= STOP_RAD && Math.sign(th) === -sign && Math.abs(om) < BB3_HIVE_REST_W) {
        arrived = t;
      }
      let stillIn = 0;
      for (const id of ids) {
        const b = world.balls.find((x) => x.id === id);
        if (!b) continue;
        const z = b.z + (b.r ?? BB_POLLEN_R);
        if (insideCell(b.pos.x, b.pos.y, z, A, 1, th) || insideCell(b.pos.x, b.pos.y, z, A, -1, th)) {
          stillIn++;
          continue;
        }
        if (!leftCell.has(id)) leftCell.set(id, t);
        if (!landed.has(id) && b.z <= 0.25 && Math.abs(b.vz) < 2) landed.set(id, t);
      }
      if (emptied < 0 && stillIn === 0) emptied = t;
    }
    const swing = (arrived - left) / 60;
    const falls = ids.map((id) => ((landed.get(id) ?? 1e9) - (leftCell.get(id) ?? 0)) / 60);
    const worstFall = Math.max(...falls);
    console.log(
      `[smoke-bb hive3d] 8-POLLEN tip: broke away at tick ${left}, cell empty at ${emptied} ` +
        `(${((emptied - left) / 60).toFixed(2)}s later), far stop at ${arrived} (swing ${swing.toFixed(2)}s); ` +
        `falls ${falls.map((f) => f.toFixed(2)).join(', ')}s`,
    );
    check(
      `the swing is stop-to-stop in about BB_TIP_SWING_S (${BB_TIP_SWING_S}s), the owner's ruling`,
      arrived > left && Math.abs(swing - BB_TIP_SWING_S) < 0.5,
      `measured ${swing.toFixed(2)}s (left the stop at tick ${left}, arrived at ${arrived})`,
    );
    /**
     * ⚠️ **"EVERY ELEMENT LANDS WITHIN 1.0 s" IS ABOUT THE FALL, NOT ABOUT THE SWING**, and the
     * measurement is what settles which reading the sentence can carry. The tray takes 4.0 s stop
     * to stop by the owner's own ruling and does not pass LEVEL until 2.0 s in, so no element can
     * be on the tiles a second after the tip STARTS — that reading would contradict a ruling this
     * same lane checks two lines up. What is measurable, and what the sentence is about, is the
     * interval between an element leaving the cell and reaching the tiles: a ~30-in fall, about
     * 0.4 s, with 1.0 s the generous bound.
     *
     * MEASURED, and worth writing down because it surprised: the cell is not empty until 3.45 s
     * after the breakaway — 1.45 s after level. The tray floor's friction is 0.6 and its tilt is
     * 30°, and `atan(0.6)` is 30.96°, so the pile sits almost exactly at its own sliding threshold
     * as the tray passes level; what gets the elements out is ROLLING, which has no such
     * threshold, and rolling out of an 11.75-in cell takes a moment. That is a real hive's
     * behaviour rather than a defect: a tray does not fling its load, it lets it run out.
     */
    check(
      'a swing empties the cell, and every element LANDS within 1.0 s of leaving it',
      emptied >= 0 && Number.isFinite(worstFall) && worstFall <= 1.0,
      `worst fall ${worstFall.toFixed(2)}s; the cell emptied ${((emptied - left) / 60).toFixed(2)}s after breakaway`,
    );
    const stillListed = ids.filter((id) => world.biobuzz!.hives[A].contents.includes(id));
    check('after the swing the cell reads empty', stillListed.length === 0, `${stillListed.length} still listed`);
  }

  // ---- the detent: a torque balance, not the table -------------------------------------------
  if (BB3_HIVE_DYNAMIC) {
    const under = loaded(850, 7, 0).world;
    const over = loaded(851, 8, 0).world;
    for (let t = 0; t < 120; t++) {
      step3d(under, 1 / 60, new Map());
      step3d(over, 1 / 60, new Map());
    }
    const thU = hiveTiltAngle(under, A);
    const thO = hiveTiltAngle(over, A);
    const pullU = Math.abs(hiveContentsTorque(under, A, thU));
    const holdU = hiveHoldTorque(A, thU);
    console.log(
      `[smoke-bb hive3d] 7p pulls ${pullU.toFixed(0)} against a hold of ${holdU.toFixed(0)}; 8p pulls ` +
        `${Math.abs(hiveContentsTorque(over, A, thO)).toFixed(0)}`,
    );
    check(
      'the detent is a TORQUE BALANCE: 7 POLLEN pull less than the hold, and the tray has not moved',
      pullU < holdU && Math.abs(Math.abs(thU) - REST_RAD) < 2e-3,
      `pull ${pullU.toFixed(0)} hold ${holdU.toFixed(0)} theta ${((thU * 180) / Math.PI).toFixed(2)}deg`,
    );
  }

  // ---- the mouth takes a shot; the closed faces bounce ---------------------------------------
  //
  // The CELL is open at its OUTER end only (owner ruling 2026-09-12): a LAUNCH has to arrive over
  // that lip travelling toward the pivot. Under the 3D tray there is no capture predicate at all
  // — the cell is a box with one side missing — so this is a check that the BOX is the right way
  // round, which nothing else asserts.
  {
    function shoot(from: 'mouth' | 'back' | 'side', seed: number): boolean {
      const w = mkWorld3d('free', seed);
      w.balls.length = 0;
      const theta = hiveTiltAngle(w, A);
      const side: 1 | -1 = w.biobuzz!.hives[A].up === 'north' ? 1 : -1;
      const box = hiveCellLocalBox(side, A);
      const mouthV = side > 0 ? box.vMax : box.vMin;
      const mid = (box.wMin + box.wMax) / 2;
      // start just OUTSIDE the chosen face and aim through the cell's centre
      const start =
        from === 'mouth'
          ? cellPoint(A, theta, 0, mouthV + side * 6, mid)
          : from === 'back'
            ? cellPoint(A, theta, 0, (side > 0 ? box.vMin : box.vMax) - side * 6, mid)
            : cellPoint(A, theta, box.xHalf + 6, (box.vMin + box.vMax) / 2, mid);
      const aim = cellPoint(A, theta, 0, (box.vMin + box.vMax) / 2, box.wMin + BB_POLLEN_R);
      const dx = aim.x - start.x;
      const dy = aim.y - start.y;
      const dz = aim.z - start.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const speed = 120;
      w.balls.push({
        id: 1,
        color: 'yellow',
        state: { kind: 'flight', target: 'blue' },
        pos: { x: start.x, y: start.y },
        vel: { x: (dx / d) * speed, y: (dy / d) * speed },
        z: start.z - BB_POLLEN_R,
        vz: (dz / d) * speed,
        r: BB_POLLEN_R,
      } as Artifact);
      for (let t = 0; t < 300; t++) step3d(w, 1 / 60, new Map());
      return w.biobuzz!.hives[A].contents.includes(1);
    }
    check('a shot through the OPEN mouth is taken', shoot('mouth', 860), 'shot from outboard, aimed inboard');
    check('a shot at the CLOSED back bounces off', !shoot('back', 861), 'shot from the pivot side');
    check('a shot at a CLOSED side bounces off', !shoot('side', 862), 'shot from across the hive axis');
  }

  // ---- G409: the spill tag, with and without a robot under -----------------------------------
  if (BB3_HIVE_DYNAMIC) {
    /** run a tip and report whether anything was tagged, and how many G409 lines were written. */
    function tipWithRobot(under: boolean, seed: number): { tagged: number; g409: number } {
      const { world } = loaded(seed, 8, 0);
      if (under) {
        /**
         * Park the robot under the mouth of the cell that IS UP — which is the cell about to go
         * DOWN, and therefore where its contents come out. The reference's words are "outboard of
         * the down cell", which names the same place from the other end of the swing; taking them
         * literally at STAGING time parks the robot under the wrong cell and nothing is ever
         * caught. Measured: zero G409 lines with all eight elements correctly tagged.
         */
        const theta = hiveTiltAngle(world, A);
        const upSide: 1 | -1 = world.biobuzz!.hives[A].up === 'north' ? 1 : -1;
        const box = hiveCellLocalBox(upSide, A);
        const mouthV = upSide > 0 ? box.vMax : box.vMin;
        const p = cellPoint(A, theta, 0, mouthV, box.wMin);
        const r = world.robots[0];
        r.pos.x = p.x;
        r.pos.y = p.y;
        r.heading = 0;
        r.vel.x = 0;
        r.vel.y = 0;
      } else {
        world.robots[0].pos.x = 0;
        world.robots[0].pos.y = 60;
      }
      let tagged = 0;
      const before = world.events.length;
      for (let t = 0; t < 600; t++) {
        step3d(world, 1 / 60, new Map());
        const n = Object.keys(world.biobuzz!.spill ?? {}).length;
        if (n > tagged) tagged = n;
      }
      const g409 = world.events.slice(before).filter((e) => e.includes('G409')).length;
      return { tagged, g409 };
    }
    const away = tipWithRobot(false, 870);
    const beneath = tipWithRobot(true, 871);
    console.log(
      `[smoke-bb hive3d] G409: robot away → ${away.tagged} tagged / ${away.g409} lines; robot under → ${beneath.tagged} tagged / ${beneath.g409} lines`,
    );
    check(
      'G409: a tipping cell tags its contents as spilling',
      away.tagged >= 8 && beneath.tagged >= 8,
      `away ${away.tagged}, under ${beneath.tagged} (8 staged)`,
    );
    check(
      'G409: with NO robot under the hive nothing is billed',
      away.g409 === 0,
      `${away.g409} lines with the robot parked 60in away`,
    );
    check(
      'G409: a robot under the down CELL catches the spill and is billed',
      beneath.g409 > 0,
      `${beneath.g409} lines`,
    );
    const { world: w2 } = loaded(872, 8, 0);
    for (let t = 0; t < 900; t++) step3d(w2, 1 / 60, new Map());
    check(
      'G409: the spill map is empty again once the elements are on the tiles',
      w2.biobuzz!.spill === undefined || Object.keys(w2.biobuzz!.spill).length === 0,
      `${Object.keys(w2.biobuzz!.spill ?? {}).length} still tagged`,
    );
  }

  // ---- determinism: the dynamic tray is a pure function of the JSON ---------------------------
  if (BB3_HIVE_DYNAMIC) {
    const angles: string[] = [];
    for (let run = 0; run < 2; run++) {
      const { world } = loaded(880, 8, 0);
      for (let t = 0; t < 300; t++) step3d(world, 1 / 60, new Map());
      angles.push(
        `${world.biobuzz!.hives[A].angle}|${world.biobuzz!.hives[A].angVel}|${world.biobuzz!.hives[A].tips}|${world.biobuzz!.hives[A].up}`,
      );
    }
    check('determinism: two identical tips produce the identical tray state', angles[0] === angles[1], `${angles[0]} vs ${angles[1]}`);
  }
}
