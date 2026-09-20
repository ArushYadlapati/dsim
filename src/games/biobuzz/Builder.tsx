import type { RobotSpec } from '../../types';
import { rangeFill } from '../../ui/rangeFill';
import {
  BB3_HEIGHT_MAX,
  BB3_HEIGHT_MIN,
  BB3_STOW_MAX,
  BB_DUMP_MAX_DIST,
  BB_HOOD_DEFAULT_DEG,
  BB_SIZE_STEP,
  BB_STORAGE_MIN,
  bbDeployedHeightIn,
  bbStowHeightIn,
  bbStowLegal,
} from './config';
import {
  BB_MOUNT_POSITIONS,
  BB_SCORE_MODES,
  BB_SHOOTER_EDGES,
  BB_INTAKE_MOUNTS,
  type BbMountPos,
  type BbScoreMode,
  bbIntakeMountOf,
  mountsClash,
} from './mounts';
import {
  BB_INTAKE_KINDS,
  BB_LIFT_KINDS,
  type BbIntakeKind,
  type BbLauncherSpec,
  type BbLiftKind,
  type BbLiftSpec,
  bbCellsAdjacent,
  bbFoldTwinMount,
  bbIntakeKindOf,
  bbIsTurreted,
  bbLauncherBlocker,
  bbLauncherOf,
  bbLiftOf,
  bbResolveLiftMount,
  bbResolveMount2,
} from './mechs';
import {
  BB_INTAKE_KIND_BLURBS,
  BB_INTAKE_LABELS,
  BB_INTAKE_MOUNT_BLURBS,
  BB_INTAKE_MOUNT_LABELS,
  BB_LIFT_KIND_BLURBS,
  BB_MODE_BLURBS,
  BB_MODE_LABELS,
  BB_MOUNT_POS_LABELS,
  bbLiftKindLabel,
} from './labels';
import { bbDials } from './robotConfig';

/**
 * The BIOBUZZ half of the My Robot builder — the `GameModule.Builder` slot.
 *
 * ── WHY THIS IS A MODULE SLOT AND NOT A BRANCH IN `Menu.tsx` ────────────────
 * `Menu.tsx` renders the builder for whichever game is loaded, and it used to do it with an
 * `isDecode ? … : …` down the middle of every block. A third game turns each of those into a
 * three-way and the file grows a season every year. So the per-game blocks move OUT: the host
 * renders the game-neutral chrome (name, team, drivetrain, RPM, the chassis colour row) OUTSIDE
 * the slot, and drops this component in for everything only BIOBUZZ knows about.
 *
 * ── WHAT IS IN HERE, AND WHY IT INCLUDES THE FRAME DIALS ───────────────────
 * LAUNCHER, FLOWER SCORING, INTAKE and FRAME. Every robot carries exactly one launcher (owner
 * ruling 2026-09-12) — a single turret, a double turret or a dumper — and may carry a Box Tube,
 * the only mechanism that scores a FLOWER (see `mechs.ts`). The frame sliders look shared, and
 * their fields are — but their RANGES are not: `bbDials` intersects the R102 expansion prism with
 * the mounted sweepers' reach, so a front+back sweeper genuinely has a shorter legal chassis
 * than a front one. A host rendering the dials from DECODE's limits would offer lengths the
 * coercer then claws back, which reads to the player as the slider snapping out from under them.
 *
 * ── ORDER IS LOAD-BEARING ──────────────────────────────────────────────────
 * FRAME LAST, because every block above it clamps it: the launcher and the Box Tube set the
 * mass floor, and the intake mount sets the size envelope and the hopper cap. Picking a
 * mechanism and watching the slider below re-clamp reads as cause and effect; the reverse reads
 * as the builder fighting you.
 *
 * Presentational and STATELESS: it renders `spec` and reports edits through `setSpec`. It does
 * NOT coerce — `coerceBiobuzzSpec` is the one chokepoint, and a component that clamped as well
 * would be a second opinion about what is legal. Where it greys a cell out, it asks the SAME
 * predicates the coercer resolves with (`bbCellsAdjacent`, `mountsClash`, `bbLauncherBlocker`),
 * so the click and the coerced result agree before the round-trip.
 */
export interface BiobuzzBuilderProps {
  /** the spec being edited — already coerced by the host. */
  spec: RobotSpec;
  /** apply a partial edit. The host re-coerces and re-renders; this component does not. */
  setSpec(patch: Partial<RobotSpec>): void;
}

/**
 * A DIAL'S VALUE, AT ITS OWN STEP'S PRECISION — the belt to `coerceBiobuzzSpec`'s braces.
 *
 * The coercer snaps every size onto its slider's grid, which is where the 15-digit width was
 * actually fixed (owner re-report, 2026-09-18). This is the second line of defence: a value that
 * reaches this component off-grid anyway — a hand-edited save, a spec from a peer running an
 * older coercer — prints as `16.3` rather than as `16.331227996399747`. A slider can never mean
 * more precision than one step, so printing more is never right.
 */
function dialText(v: number, step: number): string {
  const decimals = step >= 1 ? 0 : String(step).split('.')[1]?.length ?? 1;
  return v.toFixed(decimals);
}

/** hover text for a double turret's cell that cannot take `which` turret, or undefined. */
function twinCellBlock(m: BbMountPos, at: BbMountPos, other: BbMountPos, otherName: string): string | undefined {
  if (m === 'center') return 'A double turret can’t use the centre: it neighbours every cell';
  if (m === other) return `The ${otherName} turret is here`;
  if (m !== at && bbCellsAdjacent(m, other)) return `Too close to the ${otherName} turret`;
  return undefined;
}

/** one 3x3 chassis map for a double turret's POLLEN or NECTAR turret. The other turret's cell,
 * its neighbours and the centre are disabled: two turret rings in neighbouring cells overlap on
 * every legal chassis (`BB_TWIN_PARTNER`, `mechs.ts`). */
function TwinTurretGrid(props: {
  caption: string;
  at: BbMountPos;
  other: BbMountPos;
  otherName: string;
  onPick(m: BbMountPos): void;
}) {
  const { caption, at, other, otherName, onPick } = props;
  return (
    <>
      <p className="ds-hint">{caption}</p>
      <div className="ds-opts three">
        {BB_MOUNT_POSITIONS.map((m) => {
          const why = twinCellBlock(m, at, other, otherName);
          return (
            <button
              key={m}
              className={`ds-opt mini ${at === m ? 'on' : ''}`}
              disabled={why !== undefined}
              title={why}
              onClick={() => onPick(m)}
            >
              <span className="ot">{BB_MOUNT_POS_LABELS[m]}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}

export function BiobuzzBuilder({ spec, setSpec }: BiobuzzBuilderProps) {
  // THE TWO SLOTS, READ THROUGH THE CANONICAL RESOLVERS — never off the raw `scoreMode`/
  // `shooterMount`/`bbMech` fields directly, for the same reason `robot.ts` and `elements.ts`
  // don't either: `bbLauncherOf`/`bbLiftOf` are the ONE place "what launcher, and is there a
  // Box Tube" is decided, migration included.
  const launcher = bbLauncherOf(spec, BB_HOOD_DEFAULT_DEG);
  const lift = bbLiftOf(spec);
  const intakeKind = bbIntakeKindOf(spec);
  const dials = bbDials(spec);
  const store = Math.min(spec.ballStorage ?? dials.storage.max, dials.storage.max);
  // THE HEIGHT PAIR (R105.A's expanded height and R102's starting cube). Read through the
  // resolvers rather than off the raw fields, same rule as the launcher above: `bbStowHeightIn`
  // is where "a build over the cube folds to exactly it unless it declares otherwise" is decided.
  const deployed = bbDeployedHeightIn(spec);
  const stow = bbStowHeightIn(spec);
  const folds = deployed > BB3_STOW_MAX;

  // ── WHY EVERY EDIT RE-SENDS `scoreMode`/`shooterMount` ALONGSIDE `bbMech` ──────────────
  // The container is what `coerceBbMech` (`./coerce.ts`) resolves, and the two flat fields are
  // its MIRROR — the half the shared `coerceSpec` and an older peer that has never heard of
  // `bbMech` read. An edit that changed one without the other would hand the next coercion two
  // disagreeing answers about the same launcher. So every edit goes through `send`, which writes
  // both from the one launcher it is given. The NECTAR turret's cell and the Box Tube have no
  // flat field, so they live in the container alone.
  //
  // `nextIntake` DEFAULTS TO THE CURRENT KIND, not to the sweeper: a launcher or Box Tube edit
  // rebuilds `bbMech` from scratch (it is a container, not a set of independent fields), and
  // without this default every one of those edits would silently fold the intake back to the
  // sweeper on the next coercion (`coerceBbMech` reads `bbMech.intake` off exactly what is sent).
  function send(next: BbLauncherSpec, nextLift: BbLiftSpec | null, nextIntake: BbIntakeKind = intakeKind) {
    setSpec({
      scoreMode: next.kind,
      shooterMount: next.mount,
      bbMech: { launcher: next, lift: nextLift, intake: { kind: nextIntake } },
    });
  }

  /** INTAKE pick. The launcher and the Box Tube survive the swap — same reasoning as `pickLift`
   * keeping the launcher, the other way round. */
  function pickIntake(kind: BbIntakeKind) {
    send(launcher, lift, kind);
  }

  /** LAUNCHER pick. The mount and hood survive the swap. A corner a turret was bolted to folds
   * to its nearest edge for a dumper on the next coercion. A DOUBLE turret cannot use `center`,
   * so its POLLEN turret folds off it here, and its NECTAR turret is placed at once, so the second
   * grid below opens already agreeing with the coercer. */
  function pickLauncher(kind: BbScoreMode) {
    if (kind === 'twinturret') {
      const mount = bbFoldTwinMount(launcher.mount);
      send({ kind, mount, mount2: bbResolveMount2(mount, launcher.mount2), hoodDeg: launcher.hoodDeg }, lift);
    } else {
      send({ kind, mount: launcher.mount, hoodDeg: launcher.hoodDeg }, lift);
    }
  }

  /** the launcher's (POLLEN turret's) cell. A double turret's NECTAR cell is re-resolved against
   * it, which is a no-op for any cell the grid lets you click. */
  function pickLauncherMount(m: BbMountPos) {
    send(
      launcher.kind === 'twinturret'
        ? { ...launcher, mount: m, mount2: bbResolveMount2(m, launcher.mount2) }
        : { ...launcher, mount: m },
      lift,
    );
  }

  /** a double turret's NECTAR-turret cell. */
  function pickMount2(m: BbMountPos) {
    send({ ...launcher, mount2: m }, lift);
  }

  /** HOOD angle — a dumper's only dial. */

  /** BOX TUBE pick: none, or a tube. A new tube starts at the back when that is free, else at
   * the first free perimeter cell — the same fallback `coerceBbMech` itself uses. Re-picking the
   * tube you have keeps its cell. */
  function pickLift(kind: BbLiftKind | null) {
    if (kind === null) {
      send(launcher, null);
      return;
    }
    const mount = bbResolveLiftMount('back', bbLauncherBlocker(launcher)) ?? 'back';
    send(launcher, lift ?? { kind, mount });
  }

  function pickLiftMount(m: BbMountPos) {
    if (!lift) return;
    send(launcher, { ...lift, mount: m });
  }

  const blockers = bbLauncherBlocker(launcher);

  return (
    <>
      {/* ---- LAUNCHER ---- */}
      <h3 className="ds-subh">Launcher</h3>
      {/* THREE cards: a launcher is mandatory, so there is no "none" to offer. */}
      <div className="ds-opts three">
        {BB_SCORE_MODES.map((m) => (
          <button
            key={m}
            className={`ds-opt ${launcher.kind === m ? 'on' : ''}`}
            onClick={() => pickLauncher(m)}
          >
            <span className="ot">{BB_MODE_LABELS[m]}</span>
            <span className="od">{BB_MODE_BLURBS[m]}</span>
          </button>
        ))}
      </div>
      {/* The mount means a different thing per launcher, so it is a different picker.
          SINGLE TURRET: where the turret is BOLTED. It aims itself, so this is a position, not
          a facing. Nine positions laid out as a 3x3 map of the chassis (front row on top).
          DOUBLE TURRET: two such maps, one per turret, each greying out where the other turret
          already is.
          DUMPER: which chassis EDGE it throws over — four sides, since the launch line spans a
          whole side.

          NO CELL IS GATED against the sweeper: the launcher sits ABOVE the deck and the sweeper
          on the floor, so a front sweeper feeding a front dumper is a legal build. */}
      {launcher.kind === 'turret' && (
        <div className="ds-opts three">
          {BB_MOUNT_POSITIONS.map((m) => (
            <button
              key={m}
              className={`ds-opt mini ${launcher.mount === m ? 'on' : ''}`}
              onClick={() => pickLauncherMount(m)}
            >
              <span className="ot">{BB_MOUNT_POS_LABELS[m]}</span>
            </button>
          ))}
        </div>
      )}
      {launcher.kind === 'twinturret' && (
        <>
          <TwinTurretGrid
            caption="POLLEN turret"
            at={launcher.mount}
            other={launcher.mount2 ?? bbResolveMount2(launcher.mount, undefined)}
            otherName="NECTAR"
            onPick={pickLauncherMount}
          />
          <TwinTurretGrid
            caption="NECTAR turret"
            at={launcher.mount2 ?? bbResolveMount2(launcher.mount, undefined)}
            other={launcher.mount}
            otherName="POLLEN"
            onPick={pickMount2}
          />
        </>
      )}
      {launcher.kind === 'dumper' && (
        <div className="ds-opts four">
          {BB_SHOOTER_EDGES.map((m) => (
            <button
              key={m}
              className={`ds-opt mini ${launcher.mount === m ? 'on' : ''}`}
              onClick={() => pickLauncherMount(m)}
            >
              <span className="ot">{BB_MOUNT_POS_LABELS[m]}</span>
            </button>
          ))}
        </div>
      )}
      {/* NO ELEVATION DIAL FOR EITHER. A turret solves its own elevation per shot, and a dumper
          lobs each dump for its distance (owner, 2026-09-13 — `bbLobThrow`), so a Hood slider
          would offer a control the sim never reads. One line says what each does instead. */}
      {bbIsTurreted(launcher) ? (
        <p className="ds-hint">A turret sets its own elevation for every shot.</p>
      ) : (
        <p className="ds-hint">A dumper lobs its load from up to {BB_DUMP_MAX_DIST} in away.</p>
      )}

      {/* ---- FLOWER SCORING: the Box Tube ---- */}
      <h3 className="ds-subh">Flower scoring</h3>
      <div className="ds-opts two">
        <button className={`ds-opt ${lift === null ? 'on' : ''}`} onClick={() => pickLift(null)}>
          <span className="ot">None</span>
        </button>
        {BB_LIFT_KINDS.map((k) => (
          <button key={k} className={`ds-opt ${lift?.kind === k ? 'on' : ''}`} onClick={() => pickLift(k)}>
            <span className="ot">{bbLiftKindLabel(k)}</span>
            <span className="od">{BB_LIFT_KIND_BLURBS[k]}</span>
          </button>
        ))}
      </div>
      {lift && (
        /* The same 3x3 chassis map. A tube and a launcher both sit ABOVE the deck, so this grid
           CAN clash with the launcher — both turrets of a double turret, or a dumper's whole
           edge (`bbLauncherBlocker`). The centre is never offered: the placement point has to
           sit past a chassis edge to reach a FLOWER. No height dial — a tube places at a point. */
        <div className="ds-opts three">
          {BB_MOUNT_POSITIONS.map((m) => {
            const centre = m === 'center';
            const clash =
              !centre && lift.mount !== m && blockers.some((b) => mountsClash({ pos: m, spansEdge: false }, b));
            return (
              <button
                key={m}
                className={`ds-opt mini ${lift.mount === m ? 'on' : ''}`}
                disabled={centre || clash}
                title={centre ? 'The tube sits on the frame edge' : clash ? 'The launcher is mounted here' : undefined}
                onClick={() => pickLiftMount(m)}
              >
                <span className="ot">{BB_MOUNT_POS_LABELS[m]}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* ---- INTAKE ---- */}
      <h3 className="ds-subh">Intake</h3>
      {/* THREE cards, same anatomy as the launcher picker above: every build carries an intake,
          so there is no "none" to offer. All three take a ground POLLEN identically; the blurb
          says the one thing that actually differs — whether it reaches into a FLOWER. */}
      <div className="ds-opts three">
        {BB_INTAKE_KINDS.map((k) => (
          <button
            key={k}
            className={`ds-opt ${intakeKind === k ? 'on' : ''}`}
            onClick={() => pickIntake(k)}
          >
            <span className="ot">{BB_INTAKE_LABELS[k]}</span>
            <span className="od">{BB_INTAKE_KIND_BLURBS[k]}</span>
          </button>
        ))}
      </div>
      <div className="ds-opts four">
        {BB_INTAKE_MOUNTS.map((m) => (
          <button
            key={m}
            className={`ds-opt mini ${bbIntakeMountOf(spec) === m ? 'on' : ''}`}
            onClick={() => setSpec({ intakeMount: m })}
          >
            <span className="ot">{BB_INTAKE_MOUNT_LABELS[m]}</span>
            {BB_INTAKE_MOUNT_BLURBS[m] ? <span className="od">{BB_INTAKE_MOUNT_BLURBS[m]}</span> : null}
          </button>
        ))}
      </div>

      {/* ---- FRAME: clamped by every block above, so it comes last ---- */}
      <h3 className="ds-subh">Frame</h3>
      <div className="ds-fields">
        <label className="ds-field">
          <span className="cap">
            Length <span className="val">{dialText(spec.length, BB_SIZE_STEP)}&quot;</span>
          </span>
          <input
            className="ds-range"
            type="range"
            min={dials.length.min}
            max={dials.length.max}
            step={BB_SIZE_STEP}
            value={spec.length}
            style={rangeFill(spec.length, dials.length.min, dials.length.max)}
            onChange={(e) => setSpec({ length: Number(e.target.value) })}
          />
        </label>
        <label className="ds-field">
          <span className="cap">
            Width <span className="val">{dialText(spec.width, BB_SIZE_STEP)}&quot;</span>
          </span>
          <input
            className="ds-range"
            type="range"
            min={dials.width.min}
            max={dials.width.max}
            step={BB_SIZE_STEP}
            value={spec.width}
            style={rangeFill(spec.width, dials.width.min, dials.width.max)}
            onChange={(e) => setSpec({ width: Number(e.target.value) })}
          />
        </label>
        <label className="ds-field">
          <span className="cap">
            Mass <span className="val">{dialText(spec.massLb, 0.1)} lb</span>
          </span>
          <input
            className="ds-range"
            type="range"
            min={dials.mass.min}
            max={dials.mass.max}
            step={1}
            value={spec.massLb}
            style={rangeFill(spec.massLb, dials.mass.min, dials.mass.max)}
            onChange={(e) => setSpec({ massLb: Number(e.target.value) })}
          />
        </label>
        {/* HOPPER sits with the FRAME, under the dimensions, because that is what sets it: the
            cap is footprint × archetype × intake mount (`bbStorageMax`), clamped to the owner's
            4-element cap (2026-09-12).
            Full-width on its own row deliberately — a fourth 140px column would orphan-wrap.
            POLLEN, not "balls": it is the word on the field. */}
        <label className="ds-field wide">
          <span className="cap">
            Hopper{' '}
            <span className="val">
              {store} / {dials.storage.max} pollen
            </span>
          </span>
          <input
            className="ds-range"
            type="range"
            min={BB_STORAGE_MIN}
            max={dials.storage.max}
            step={1}
            value={store}
            style={rangeFill(store, BB_STORAGE_MIN, dials.storage.max)}
            onChange={(e) => setSpec({ ballStorage: Number(e.target.value) })}
          />
        </label>
        {/* HEIGHT, the third chassis dimension — R105.A's own vertical one, and the last of the
            three to become real (the 2D pipeline never asked; the 3D chassis collider is
            extruded to it, and the 3D preview stands this tall). It sits with LENGTH and WIDTH
            because it is the same kind of number, and it is the one dial on this panel with a
            RULE hanging off it: over 18 in the build has to fold to start, which is the row
            below and the note under it. */}
        <label className="ds-field">
          <span className="cap">
            Height <span className="val">{dialText(deployed, 1)}&quot;</span>
          </span>
          <input
            className="ds-range"
            type="range"
            min={BB3_HEIGHT_MIN}
            max={BB3_HEIGHT_MAX}
            step={1}
            value={deployed}
            style={rangeFill(deployed, BB3_HEIGHT_MIN, BB3_HEIGHT_MAX)}
            onChange={(e) => setSpec({ heightIn: Number(e.target.value) })}
          />
        </label>
        {/* THE DECLARED STOW HEIGHT (R102) — only for a build that is over the cube, because for
            anything at or under 18 in the answer is its own height and a slider that can only be
            set to the value it already has is chrome. A build over the cube is MODELLED as
            folding to exactly 18 unless it says otherwise (`bbStowHeightIn`), so that is where
            this starts; declaring more than 18 is allowed and is REFUSED by the rule rather than
            clamped away, which is what makes the note below able to say no. */}
        {folds && (
          <label className="ds-field">
            <span className="cap">
              Stow height <span className="val">{dialText(stow, 1)}&quot;</span>
            </span>
            <input
              className="ds-range"
              type="range"
              min={BB3_HEIGHT_MIN}
              max={deployed}
              step={1}
              value={stow}
              style={rangeFill(stow, BB3_HEIGHT_MIN, deployed)}
              onChange={(e) => setSpec({ stowHeightIn: Number(e.target.value) })}
            />
          </label>
        )}
      </div>
      <StowHeightNote spec={spec} />
    </>
  );
}

/**
 * THE R102 STOW CHECK — the builder's half of the height rule (`docs/biobuzz/plan-3d.md` §3.3).
 *
 * R105.A lets a ROBOT stand 29 in once the MATCH has started; R102 limits the STARTING
 * CONFIGURATION to an 18-in cube. So a tall build is legal only because it FOLDS, and the moment
 * a robot has a height at all (`heightIn`, which the 3D physics extrudes its collider to) that
 * stops being a detail: a build that cannot get under the cube cannot start, and `startLegal`
 * refuses its ready-up (`sim.ts`). This is where a player finds that out — at the dial, not at
 * the lobby.
 *
 * A build INSIDE the cube says nothing at all. A line that appears under every robot to report
 * that 18 is not more than 18 is chrome, and the one thing a warning may not be is routine.
 */
function StowHeightNote({ spec }: { spec: RobotSpec }) {
  const deployed = bbDeployedHeightIn(spec);
  if (deployed <= BB3_STOW_MAX) return null;
  const stow = bbStowHeightIn(spec);
  if (!bbStowLegal(spec)) {
    return (
      <p className="ds-hint">
        Can’t start: this build stands {deployed}&quot; and stows to {stow}&quot;, over R102’s{' '}
        {BB3_STOW_MAX}&quot; starting cube. Lower it, or declare a stow under {BB3_STOW_MAX}&quot;.
      </p>
    );
  }
  return (
    <p className="ds-hint">
      {deployed}&quot; deployed — stows to {stow}&quot; to start (R102), and deploys when the match
      begins.
    </p>
  );
}
