import type { Alliance, Artifact, RobotCommand, RobotSpec, World } from '../../src/types';
import * as C from '../../src/config';
import { worldHash } from '../../src/net/checksum';
import {
  BB3D_CAP,
  BB3D_REFUSAL,
  CLIENT_CAPS,
  applyBallDelta,
  decodeServerMsg,
  encodeBallDelta,
  encodeMsg,
  physicsAllowed,
  quantizeCommand,
  slimWorld,
  unslimWorld,
  type ServerMsg,
} from '../../src/net/protocol';
import { simModuleFor } from '../../src/games/sim';
import { DEFAULT_ASSISTS } from '../../src/sim/spawn';
import { ReplayPlayer, maxMatchTicks, runRecordMatch, type Replay } from '../../src/sim/replay';
import { Room, type Client } from '../../server/room';
import { BB_DEFAULT_SPEC } from '../../src/games/biobuzz/robotConfig';
import { readFileSync } from 'node:fs';
import { cmd, setup, type Check } from './harness';

/**
 * NET3D — a 3D-physics BIOBUZZ match through the REAL authoritative `Room`, the real wire
 * codec, and the real replay container (Day 2 lane C, `docs/biobuzz/plan-3d.md` §7).
 *
 * ── WHAT THIS LANE IS FOR THAT THE OTHERS ARE NOT ──────────────────────────
 * `SIM3D` proves the 3D solve is right. `SERVER` (in `field.ts`) proves a BIOBUZZ room runs.
 * Neither says anything about the seam between them, and that seam is where every bug in this
 * day's work would live: a room whose `physics` never reached `createWorld` plays a 2D match
 * while `matchStart` claims 3D, and NOTHING about it looks wrong — the score is plausible, the
 * snapshots decode, the replay plays back, and the only symptom is that a leaderboard is
 * quietly two leaderboards. So every check below is about a value ARRIVING somewhere, not
 * about physics being correct.
 *
 * ── THE 2D HALF IS NOT PADDING ────────────────────────────────────────────
 * The owner's rule is that the 2D pipeline is permanent, and one Fly app serves every client
 * version — so "a room created without `physics` behaves exactly as it did before" is a real
 * requirement with a real failure mode: a defaulted `'2d'` string appearing in a container, a
 * snapshot or a handshake is a change to bytes that older clients and stored rows already
 * depend on. Half the checks here are that nothing moved.
 *
 * ⚠️ NOTHING HERE MAY HARDCODE FIELD GEOMETRY. The BIOBUZZ constants are being tuned against
 * the CAD in parallel; every assertion below is about ids, counts, tags and equality between
 * two runs, never about a position or a score being a particular number.
 */

/** the four seats of a 2v2, the same roster shape `field.ts`'s SERVER lane uses */
const ROSTER: { id: string; alliance: Alliance; startIndex: number }[] = [
  { id: 'n3-b1', alliance: 'blue', startIndex: 0 },
  { id: 'n3-b2', alliance: 'blue', startIndex: 1 },
  { id: 'n3-r1', alliance: 'red', startIndex: 0 },
  { id: 'n3-r2', alliance: 'red', startIndex: 1 },
];

/**
 * ⚠️ A `Client.send` IS HANDED A LIVE VIEW OF THE WORLD, NOT A COPY — and every check in this
 * file that compares two moments would be a lie without this function.
 *
 * `slimWorld` SPREADS the world and `stripSpec` spreads each robot, so the result is a fresh
 * object graph one level deep whose `pos`, `vel`, `match.scores` and `state` are still the
 * SAME objects the sim mutates in place; `encodeBallDelta` likewise hands over the live
 * `Artifact`s. In production nothing notices, because `server/index.ts` JSON-encodes the frame
 * onto a socket the same turn. A test that keeps the object instead ends up holding four
 * thousand aliases of one world: the first snapshot and the last read identical, the score at
 * kickoff equals the score at the buzzer, and a match nobody drove looks exactly like a match
 * that was driven hard. All three of those passed as failures here before this existed.
 *
 * So the sink does what the transport does: encode, then decode. `decodeServerMsg(encodeMsg(m))`
 * is the exact round-trip a real client's bytes take, which also makes the "a 2D room's
 * snapshot never mentions physics" check a statement about the WIRE rather than about an
 * object literal.
 */
const wireCopy = (m: ServerMsg): ServerMsg => decodeServerMsg(encodeMsg(m));

function mkClient(
  seat: { id: string; alliance: Alliance; startIndex: number },
  onMsg: (m: ServerMsg) => void,
  caps: string[] = CLIENT_CAPS,
): Client {
  return {
    id: seat.id,
    send: onMsg,
    player: {
      clientId: seat.id,
      name: seat.id,
      teamName: 'Smoke',
      teamNumber: 1,
      alliance: seat.alliance,
      startIndex: seat.startIndex,
      ready: true,
      spec: { ...BB_DEFAULT_SPEC },
      assists: { ...DEFAULT_ASSISTS },
    },
    connected: true,
    disconnectAt: 0,
    caps,
  };
}

/**
 * A BUSY DRIVER, as a pure function of tick and seat.
 *
 * Deterministic and fully scripted, because a check that depends on when a key was pressed is
 * a check that cannot be re-run. It drives, turns, holds intake and fires on a beat — the same
 * shape `costprobe`'s busy robot uses, and for the same reason: an idle room exercises neither
 * the archetype's code nor the wire.
 *
 * ⚠️ `fieldCentric` is FALSE on these setups (`harness.setup`). With the default assists true,
 * a robot that turns and then drives "forward" goes nowhere and parks in a corner — after
 * which any two runs agree and every comparison below proves nothing. That trap is written
 * down in `docs/area/netcode.md` and it has cost real time twice.
 */
const drive = (tick: number, seat: number): RobotCommand => {
  const p = tick / 60 + seat * 1.7;
  return cmd({
    driveX: Math.sin(p * 0.9),
    driveY: Math.cos(p * 0.7),
    rotate: Math.sin(p * 1.3) * 0.5,
    intake: true,
    fire: tick % 90 > 20,
  });
};

/** the physics tag on a world, read the way every consumer reads it */
const physicsOf = (w: World): string =>
  (w as { biobuzz?: { physics?: string } }).biobuzz?.physics ?? '2d';

/** how many of this world's elements are in flight right now */
const airborne = (w: World): number => w.balls.filter((b) => b.state.kind === 'flight').length;
/** how many are in a robot's hopper right now */
const heldNow = (w: World): number => w.balls.filter((b) => b.state.kind === 'held').length;

export function net3dChecks(check: Check): void {
  // ═══ 1. THE ROOM BUILDS THE WORLD ITS CONFIG ASKED FOR ═════════════════════
  //
  // The whole day rests on this one value arriving, so it is asserted at the room, at the
  // handshake, and in the world — three places, because a room that knows its physics and a
  // world that runs it are different facts and the bug is the gap between them.
  {
    const msgs: ServerMsg[] = [];
    const room = new Room('n3-cfg', () => {}, { kind: 'versus', game: 'biobuzz', physics: '3d' });
    check('room: a config asking for 3D gives a 3D room', room.physics === '3d', room.physics);
    for (const s of ROSTER) {
      room.add(mkClient(s, s.id === 'n3-b1' ? (m) => msgs.push(wireCopy(m)) : () => {}));
    }
    room.onMessage('n3-b1', { t: 'start' });
    // FOUR TICKS, because `beginMatch` broadcasts `matchStart` and then hands the room to its
    // own 60 Hz timer — the first snapshot is a tick or two away, and `SNAPSHOT_INTERVAL` is 2.
    // `advanceForTest` also drops that timer, which is what stops a lane leaving live rooms
    // ticking behind it.
    room.advanceForTest(4);
    const start = msgs.find((m) => m.t === 'matchStart') as
      | Extract<ServerMsg, { t: 'matchStart' }>
      | undefined;
    check('room: matchStart carries physics:"3d"', start?.physics === '3d', `physics=${String(start?.physics)}`);
    const snap = msgs.find((m) => m.t === 'snapshot') as
      | Extract<ServerMsg, { t: 'snapshot' }>
      | undefined;
    check(
      'room: ...and the world the room actually built is a 3D one',
      !!snap && physicsOf(snap.w as unknown as World) === '3d',
      snap ? physicsOf(snap.w as unknown as World) : 'no snapshot',
    );
  }

  // ═══ 2. A RANKED / RECORD ROOM IS 3D WHETHER THE CLIENT ASKED OR NOT ═══════
  //
  // The server decides this one (plan §2.1) — a board fed by two solves is two boards — so the
  // config is deliberately the WRONG answer in each case and the room has to overrule it.
  {
    const rec = new Room('n3-rec', () => {}, { kind: 'record', record: 'solo', game: 'biobuzz' });
    check('room: a RECORD room is 3D even with no physics in its config', rec.physics === '3d', rec.physics);
    const dec = new Room('n3-dec', () => {}, { kind: 'record', record: 'solo', game: 'decode' });
    check(
      'room: ...but only for a game that HAS a 3D solve — a DECODE record room is untouched',
      dec.physics === '2d',
      dec.physics,
    );
    const forced = new Room('n3-forced', () => {}, { kind: 'versus', game: 'decode', physics: '3d' });
    check(
      'room: a DECODE room asked for 3D stays 2D rather than handing step() a physics it cannot run',
      forced.physics === '2d',
      forced.physics,
    );
  }

  // ═══ 3. THE OLD-CLIENT PROOF: a room with NO physics is what it always was ══
  {
    const msgs: ServerMsg[] = [];
    const room = new Room('n3-2d', () => {}, { kind: 'versus', game: 'biobuzz' });
    check('room: a config with no physics is a 2D room', room.physics === '2d', room.physics);
    for (const s of ROSTER) {
      room.add(mkClient(s, s.id === 'n3-b1' ? (m) => msgs.push(wireCopy(m)) : () => {}));
    }
    room.onMessage('n3-b1', { t: 'start' });
    room.advanceForTest(4); // see the note in the 3D room above
    const start = msgs.find((m) => m.t === 'matchStart') as
      | Extract<ServerMsg, { t: 'matchStart' }>
      | undefined;
    /**
     * ABSENT, not `'2d'`. An older client ignores an unknown key either way, but a key that
     * appears is a change to the handshake bytes every stored and relayed copy already has.
     *
     * ⚠️ MEASURED ON THE ENCODED FRAME, not with `'physics' in start`. An object literal
     * written `physics: cond ? '3d' : undefined` HAS the key — with the value `undefined` —
     * so the `in` test answers true and would pass this check while the bytes were fine, or
     * fail it while they were fine. `JSON.stringify` drops an undefined value, and the wire is
     * what both halves of this rule are actually about.
     */
    check(
      'wire: a 2D room omits `physics` from matchStart entirely (absent already reads 2d)',
      !!start && !JSON.stringify(start).includes('physics'),
      start ? JSON.stringify(start).slice(0, 120) : 'no matchStart',
    );
    const snap = msgs.find((m) => m.t === 'snapshot') as
      | Extract<ServerMsg, { t: 'snapshot' }>
      | undefined;
    check(
      'wire: ...and nothing in its snapshot stream mentions physics at all',
      !!snap && !JSON.stringify(snap).includes('physics'),
      snap ? 'found the string in a 2D snapshot' : 'no snapshot',
    );
  }

  // ═══ 4. THE 2D PIPELINE IS BYTE-IDENTICAL TO THE PRE-CHANGE CALL ═══════════
  //
  // THE GOLDEN IS COMPUTED IN THIS RUN, from the four-argument call — which is literally the
  // pre-change signature, since `physics` is a trailing optional fifth parameter. So this is
  // not "the numbers look the same as last time I looked"; it is the old call and the new one,
  // stepped side by side, on the same seed, in the same process.
  {
    const mod = simModuleFor('biobuzz');
    const setups = [setup(0, 'blue', {}, 0), setup(1, 'red', {}, 1)];
    // the PRE-CHANGE call: four arguments, exactly as every caller wrote it before Day 2
    const before = mod.createWorld('match', 9090, setups);
    // the new call, saying explicitly what the old one meant
    const after = mod.createWorld('match', 9090, setups, undefined, '2d');
    check('2d-parity: the four-argument call still builds a 2D world', physicsOf(before) === '2d', physicsOf(before));
    check('2d-parity: ...and it is byte-identical to an explicit 2D one at tick 0',
      JSON.stringify(before) === JSON.stringify(after));

    let drift = -1;
    for (let t = 1; t <= 600; t++) {
      const cmds = new Map<number, RobotCommand>([
        [0, drive(t, 0)],
        [1, drive(t, 1)],
      ]);
      mod.step(before, C.SIM_DT, new Map(cmds));
      mod.step(after, C.SIM_DT, new Map(cmds));
      if (drift < 0 && worldHash(before) !== worldHash(after)) drift = t;
    }
    check(
      '2d-parity: 600 driven ticks later the two worlds still hash identically',
      drift < 0,
      drift < 0 ? '' : `diverged at tick ${drift}`,
    );
    // ...and the WIRE form too, which is the half a client sees. `slimWorld` spreads the world,
    // so a stray key anywhere in it would show up here and nowhere else.
    check(
      '2d-parity: ...and their wire snapshots are the same bytes',
      JSON.stringify(slimWorld(before)) === JSON.stringify(slimWorld(after)),
    );
  }

  // ═══ 5. THE CAPABILITY GATE ════════════════════════════════════════════════
  //
  // The predicate AND the four places that are supposed to call it. The predicate alone is a
  // vacuous check: it is five lines and it cannot be wrong in an interesting way. What can be
  // wrong — silently, and only in production — is a door that never asks it, which is why the
  // second half reads the server source.
  {
    check('caps: the refusal says exactly what the plan says it says',
      BB3D_REFUSAL === 'Update DSIM to play this room.', BB3D_REFUSAL);
    check('caps: this build advertises the capability', CLIENT_CAPS.includes(BB3D_CAP));
    check('caps: a 3D room refuses a client with no caps at all', !physicsAllowed('3d', []));
    check('caps: ...and one whose caps predate it', !physicsAllowed('3d', ['strategy', 'startpose', 'game']));
    check('caps: a current client is admitted', physicsAllowed('3d', CLIENT_CAPS));
    // A 2D ROOM ADMITS EVERYONE. This is the back-compat rule the whole gate is written
    // around, and it is the one that would be broken by "just require the cap everywhere".
    check('caps: a 2D room admits a client with no caps, exactly as it always did', physicsAllowed('2d', []));
    check('caps: an ABSENT physics is a 2D room and admits everyone', physicsAllowed(undefined, []));

    const server = readFileSync('server/index.ts', 'utf8');
    const gates = server.split('physicsAllowed(').length - 1;
    check(
      'caps: server/index.ts asks the gate at all FOUR doors (join, spectate, rejoin, queue)',
      gates === 4,
      `${gates} call sites`,
    );
    const sends = server.split('message: BB3D_REFUSAL').length - 1;
    check(
      'caps: ...and every one of them answers with the shared string, not a message of its own',
      sends === 4,
      `${sends} sends`,
    );
  }

  // ═══ 6. THE WIRE CARRIES z, AND THE CLIENT'S DECODER REBUILDS IT ═══════════
  //
  // Driven off a real 3D world rather than off a hand-made one, because the thing being tested
  // is that `slimWorld`/`encodeBallDelta` need NO change to carry the new fields — they spread
  // the whole object — and a hand-made world would prove that about a shape nothing produces.
  {
    const mod = simModuleFor('biobuzz');
    const w = mod.createWorld('match', 7777, [setup(0, 'blue', {}, 0), setup(1, 'red', {}, 1)], undefined, '3d');
    w.match.preCountdown = C.PRE_COUNTDOWN;
    let peakHeld = 0;
    let flightTicks = 0;
    let anyLift = false;
    for (let t = 1; t <= 900; t++) {
      mod.step(w, C.SIM_DT, new Map([[0, drive(t, 0)], [1, drive(t, 1)]]));
      peakHeld = Math.max(peakHeld, heldNow(w));
      if (airborne(w) > 0) flightTicks++;
      if (w.balls.some((b) => b.state.kind !== 'held' && b.state.kind !== 'stock' && b.z > 0.5)) anyLift = true;
    }
    // THE SCENE HAS TO HAVE HAPPENED, or the codec check below is a check of an idle field.
    check('wire: the scripted 3D scene actually ran the archetype (something was held)', peakHeld > 0, `peak=${peakHeld}`);
    check('wire: ...and something was in flight', flightTicks > 0, `${flightTicks} ticks with an element airborne`);
    check('wire: ...and an element left the floor (z is a live degree of freedom here)', anyLift);

    const slim = slimWorld(w);
    const delta = encodeBallDelta(null, w.balls); // a KEYFRAME: every element, as a reconnect gets
    const framed = JSON.parse(JSON.stringify({ w: slim, balls: delta })) as {
      w: typeof slim;
      balls: typeof delta;
    };
    const specById = (id: number): RobotSpec => w.robots.find((r) => r.id === id)!.spec;
    const rebuilt = unslimWorld(
      framed.w,
      applyBallDelta(new Map<number, Artifact>(), framed.balls),
      specById,
    );
    check('wire: a keyframe round-trips to the same world hash', worldHash(rebuilt) === worldHash(w),
      `${worldHash(rebuilt)} vs ${worldHash(w)}`);
    check('wire: the decoded world keeps its physics tag (a joiner reads it from the keyframe)',
      physicsOf(rebuilt) === '3d', physicsOf(rebuilt));
    check('wire: every robot arrives with a z', rebuilt.robots.every((r) => typeof r.z === 'number'),
      rebuilt.robots.map((r) => String(r.z)).join(','));
    check('wire: ...and a vz', rebuilt.robots.every((r) => typeof r.vz === 'number'));
    check('wire: all 56 elements arrive', rebuilt.balls.length === w.balls.length, `${rebuilt.balls.length}`);
    check('wire: ...each with its z intact',
      rebuilt.balls.every((b, i) => b.z === w.balls[i].z && b.vz === w.balls[i].vz));
    // and the ORDER, which is what `worldHash` and the collision iteration both depend on
    check('wire: ...in the authoritative order',
      rebuilt.balls.map((b) => b.id).join(',') === w.balls.map((b) => b.id).join(','));
  }

  // ═══ 7. A WHOLE 3D 2v2 MATCH, DRIVEN, THROUGH THE REAL ROOM ════════════════
  {
    /**
     * The sink keeps EVERY control message and a THINNED, decoded record of the snapshot
     * stream. A full match is ~5,200 snapshots of ~8 KB, and decoding all of them costs
     * several seconds for nothing: the per-snapshot facts (is it 3D, does it carry `z`, was
     * anything in flight) are folded in as they arrive, and only the first and the last frames
     * are kept whole, which is all the comparisons below need.
     */
    const control: ServerMsg[] = [];
    let snapCount = 0;
    let all3d = true;
    let allHaveZ = true;
    let flightSeen = false;
    let firstSnap: Extract<ServerMsg, { t: 'snapshot' }> | null = null;
    let lastSnap: Extract<ServerMsg, { t: 'snapshot' }> | null = null;
    const sink = (raw: ServerMsg): void => {
      if (raw.t !== 'snapshot') {
        control.push(wireCopy(raw));
        return;
      }
      const m = wireCopy(raw) as Extract<ServerMsg, { t: 'snapshot' }>;
      snapCount++;
      if (physicsOf(m.w as unknown as World) !== '3d') all3d = false;
      if (!m.w.robots.every((r) => typeof r.z === 'number')) allHaveZ = false;
      if (!flightSeen && (m.balls.upd ?? []).some((b) => b.state.kind === 'flight')) flightSeen = true;
      if (!firstSnap) firstSnap = m;
      lastSnap = m;
    };

    let outcomePhysics: string | undefined = '<onResult never called>';
    let finalized = false;
    const room = new Room(
      'n3-match',
      () => {},
      { kind: 'versus', game: 'biobuzz', physics: '3d' },
      (o) => {
        outcomePhysics = o.replay.physics ?? '(absent)';
        finalized = true;
      },
    );
    for (const seat of ROSTER) room.add(mkClient(seat, seat.id === 'n3-b1' ? sink : () => {}));
    room.onMessage('n3-b1', { t: 'start' });

    /**
     * Fed a tick at a time, because that is how a driver feeds one. `advanceForTest(n)` pumps
     * n ticks against whatever the room is already holding, so handing it the whole match in
     * one call would run four robots on a single held command for three minutes — which does
     * move them, and would make every assertion below about a scene nobody scripted.
     */
    let threw: unknown = null;
    try {
      const cap = maxMatchTicks() + 5;
      for (let t = 0; t < cap && !finalized; t++) {
        const tick = room.tick + 1;
        ROSTER.forEach((seat, i) => {
          room.onMessage(seat.id, { t: 'input', tick, q: quantizeCommand(drive(tick, i)) });
        });
        room.advanceForTest(1);
      }
    } catch (e) {
      threw = e;
    }
    check('match: a driven 3D 2v2 runs a whole match without throwing', threw === null,
      threw ? String(threw) : '');
    check('match: the room broadcast snapshots', snapCount > 0, `${snapCount}`);
    check('match: every snapshot is a 3D world', snapCount > 0 && all3d);
    check('match: every snapshot carries per-robot z', snapCount > 0 && allHaveZ);

    // THE ROBOTS MOVED. Without this, everything else here is true of four robots sitting on
    // their start poses — and `DEFAULT_ASSISTS.fieldCentric` has produced exactly that twice.
    const a = firstSnap as Extract<ServerMsg, { t: 'snapshot' }> | null;
    const b = lastSnap as Extract<ServerMsg, { t: 'snapshot' }> | null;
    const moved =
      !!a && !!b &&
      b.w.robots.every((r, i) => {
        const p = a.w.robots[i];
        return Math.hypot(r.pos.x - p.pos.x, r.pos.y - p.pos.y) > 6;
      });
    check('match: every robot drove somewhere', moved,
      a && b ? b.w.robots.map((r, i) => Math.hypot(r.pos.x - a.w.robots[i].pos.x, r.pos.y - a.w.robots[i].pos.y).toFixed(1)).join(', ') : '');

    check('match: at least one element was in flight during the match', flightSeen);

    const res = control.find((m) => m.t === 'matchResult') as
      | Extract<ServerMsg, { t: 'matchResult' }>
      | undefined;
    check('match: it reached post and broadcast matchResult', !!res);
    // THE BASELINE IS DERIVED IN THIS RUN, from the first snapshot — which is taken during
    // `pre`, so it is the staged layout's own score. Typed as a literal it would pin the
    // staging from this file, and the staging is being tuned against the CAD in parallel.
    const staged = a ? a.w.match.scores : null;
    check(
      'match: the driven match outscored the staged layout it started from',
      !!res && !!staged &&
        (res.result.score.blue > staged.blue.total || res.result.score.red > staged.red.total),
      res && staged
        ? `staged ${staged.blue.total}/${staged.red.total} → final ${res.result.score.blue}/${res.result.score.red}`
        : '',
    );

    // THE OUTCOME CARRIES THE TAG `persistMatch` WRITES TO THE DATABASE. Read off the replay,
    // which is the same place `persist.ts` and `ranked.ts` read it, so this check fails if
    // either of them is ever pointed somewhere else.
    check('match: the MatchOutcome replay is stamped physics:"3d"', outcomePhysics === '3d',
      `physics=${String(outcomePhysics)}`);
    check('match: the broadcast replay is stamped too (it is what a client stores)',
      res?.replay.physics === '3d', `physics=${String(res?.replay.physics)}`);
  }

  // ═══ 8. REPLAYS: RECORDED, JSON'd, RE-SIMULATED, TICK FOR TICK ═════════════
  //
  // ⚠️ `worldHash` covers robots, balls, scores and counts but NOT `match.phase` or
  // `phaseTimeLeft` — so two runs that started the match 200 ticks apart hash identically at
  // every sample point and prove nothing about the clock. The CLOCK IS COMPARED TOO. That trap
  // is in `docs/area/netcode.md` and it is the reason this is spelled out rather than assumed.
  //
  // Both containers go through `JSON.parse(JSON.stringify(...))` first, because a stored replay
  // reaches the verifier as JSON and an `undefined` optional field does not survive that trip —
  // which is exactly the shape `physics` has.
  const resim = (physics: '2d' | '3d', label: string): void => {
    const setups = [setup(0, 'blue', {}, 0), setup(1, 'red', {}, 1)];
    /**
     * THE TRUTH MARKS ARE TAKEN FROM INSIDE THE COMMAND SOURCE, which costs nothing.
     *
     * `CommandSource` is `(tick, world) => commands` and is called BEFORE each step, so the
     * `world` it is handed is the recorded run's own world at `world.tick` — the exact state
     * the replay will have to reproduce. Sampling it here means the comparison is against the
     * ORIGINAL RUN rather than against a second playback of the same container, which would be
     * a tautology, and it avoids stepping the match a third time to find out.
     */
    const marks = new Map<number, { hash: number; phase: string; left: number }>();
    let startPos: { x: number; y: number }[] = [];
    // PEAK, not final. A robot that fired everything it was carrying ends the run with an
    // EMPTY hopper, which is the opposite of the thing being checked — measured once as
    // `hopper 0,0` on a run that had held and fired eight elements.
    let peakHopper = 0;
    const src = (tick: number, world: World): Map<number, RobotCommand> => {
      if (world.tick === 0) startPos = world.robots.map((r) => ({ ...r.pos }));
      for (const r of world.robots) peakHopper = Math.max(peakHopper, r.hopper.length);
      if (world.tick % 60 === 0) {
        marks.set(world.tick, {
          hash: worldHash(world),
          phase: world.match.phase,
          left: world.match.phaseTimeLeft,
        });
      }
      return new Map([[0, drive(tick, 0)], [1, drive(tick, 1)]]);
    };
    // A SHORT run, not a whole match: this is a check of the CONTAINER, and the same scene is
    // paid for twice (record, then playback) for each physics. 1,500 ticks is the pre-match
    // countdown plus most of autonomous — long enough for the robots to drive, hold and fire.
    const run = runRecordMatch(424242, setups, src, { game: 'biobuzz', physics, stopTick: 1500 });

    check(`replay-${label}: the recorded run stamps its physics`,
      (run.replay.physics ?? '2d') === physics, `physics=${String(run.replay.physics)}`);
    if (physics === '2d') {
      // ABSENT from the ENCODED container, for the same reason it is absent from `matchStart`
      // — and measured the same way, because the object literal carries the key with an
      // undefined value while the JSON does not.
      check('replay-2d: ...and a 2D container writes no physics key at all',
        !JSON.stringify(run.replay).includes('physics'));
    }

    // NOT VACUOUS. Two idle robots idle identically, and a scene that proves only that is the
    // trap `docs/area/netcode.md` names twice. The archetype's own code has to have run.
    const drove =
      startPos.length > 0 &&
      run.world.robots.every((r, i) => Math.hypot(r.pos.x - startPos[i].x, r.pos.y - startPos[i].y) > 6);
    check(`replay-${label}: the run DROVE (every robot left its start pose)`, drove,
      startPos.length
        ? run.world.robots
            .map((r, i) => Math.hypot(r.pos.x - startPos[i].x, r.pos.y - startPos[i].y).toFixed(1))
            .join(', ')
        : 'no start sample');
    check(`replay-${label}: ...and the hoppers were worked (peak, not final)`, peakHopper > 0,
      `peak ${peakHopper}, final ${run.world.robots.map((r) => r.hopper.length).join(',')}`);
    check(`replay-${label}: ...and the run is worth comparing (it scored something)`,
      run.result.score.blue + run.result.score.red > 0,
      `${run.result.score.blue}/${run.result.score.red}`);

    const stored = JSON.parse(JSON.stringify(run.replay)) as Replay;
    check(`replay-${label}: the physics tag survives the JSON round-trip`,
      (stored.physics ?? '2d') === physics, `physics=${String(stored.physics)}`);

    const player = new ReplayPlayer(stored);
    check(`replay-${label}: playback builds a world on the container's own physics`,
      physicsOf(player.world) === physics, physicsOf(player.world));

    /**
     * ⚠️ THE CLOCK IS COMPARED AS WELL AS THE HASH. `worldHash` covers robots, balls, scores
     * and counts but NOT `match.phase` or `phaseTimeLeft`, so two runs that started the match
     * two hundred ticks apart hash identically at every sample point and prove nothing about
     * when anything happened. Written down in `docs/area/netcode.md`; repeated here because a
     * replay check that drops it looks exactly like one that does not.
     */
    let hashDrift = -1;
    let clockDrift = -1;
    let samples = 0;
    while (!player.done) {
      player.stepOnce();
      const m = marks.get(player.world.tick);
      if (!m) continue;
      samples++;
      if (hashDrift < 0 && worldHash(player.world) !== m.hash) hashDrift = player.world.tick;
      if (
        clockDrift < 0 &&
        (player.world.match.phase !== m.phase ||
          Math.abs(player.world.match.phaseTimeLeft - m.left) > 1e-9)
      ) {
        clockDrift = player.world.tick;
      }
    }
    check(`replay-${label}: the re-simulation was actually sampled at 60-tick marks`, samples >= 20,
      `${samples} samples`);
    check(`replay-${label}: worldHash equals the recorded run at every mark`, hashDrift < 0,
      hashDrift < 0 ? '' : `diverged at tick ${hashDrift}`);
    check(`replay-${label}: ...and so does the match clock (phase + phaseTimeLeft)`, clockDrift < 0,
      clockDrift < 0 ? '' : `clock diverged at tick ${clockDrift}`);
    check(`replay-${label}: playback reached the recorded tick count`,
      player.world.tick === run.replay.ticks, `${player.world.tick} vs ${run.replay.ticks}`);
    check(`replay-${label}: ...with the recorded run's final hash`,
      worldHash(player.world) === run.result.hash,
      `${worldHash(player.world)} vs ${run.result.hash}`);
  };

  // THE 3D ONE IS THE NEW BEHAVIOUR; THE 2D ONE IS THE PROOF NOTHING REGRESSED. Both, always:
  // a 3D replay that re-simulates while a 2D one silently stopped doing so is a worse outcome
  // than neither working, because only one of them has anybody's stored matches in it.
  resim('3d', '3d');
  resim('2d', '2d');
}
