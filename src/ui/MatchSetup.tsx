import { useState } from 'react';
import type {
  GameSettings,
  AutoPathData,
  PathLine,
  SequenceItem,
  PathPoint,
  Vec2,
  Alliance,
} from '../types';
import { MAX_SAVED_AUTOS } from '../config';
import { StartPositionEditor } from './StartPositionEditor';
import { savedStartCap } from './startPositions';
import { useAds } from '../ads/AdsProvider';
import { selectStart, switchCategory, saveStart, deleteSavedStart } from './startPositions';
import { ChainStartEditor } from './ChainStartEditor';
import { moduleFor } from '../games';
import { OptRow, ToggleRow } from './OptRow';

/**
 * A BOT TIER, IN SENTENCE CASE. The seam's tiers are opaque lower-case strings a game owns, and
 * `docs/area/ui.md` rules sentence case for every button label — so the presentation happens
 * here rather than the game's list being asked to carry display copy it would then have to keep
 * consistent with the house rules. Shared by the practice control and the lobby's.
 */
export const botLabel = (tier: string): string => tier.charAt(0).toUpperCase() + tier.slice(1);

/**
 * Match configuration — the pre-game options that belong to the MATCH, not the
 * robot: alliance, start position, practice dummies, and an imported auto path.
 * These apply to the SOLO/offline modes (Solo Practice, Free Drive, Records);
 * Ranked and Custom assign alliance + start in the lobby / strategy screen.
 *
 * The MATCH section of `Configure`. It used to be a collapsed `<details>` on the
 * homepage; now it has a route of its own (`/configure/match`), so it renders
 * open. Kept separate from the robot loadout builder on purpose. `.pp` import +
 * the Pedro-Pathing → sim coordinate transform live here.
 */
export function MatchSetup({
  settings,
  onChange,
}: {
  settings: GameSettings;
  onChange: (s: GameSettings) => void;
}) {
  const set = (patch: Partial<GameSettings>) => onChange({ ...settings, ...patch });
  /** the outcome of the last .pp import, shown in the auto-path section */
  const [notice, setNotice] = useState<{ bad: boolean; text: string } | null>(null);
  function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
  /** NOT a toast — CLAUDE.md forbids those, and this is an inline `<p>` under the
   * auto-path section. Named for what it is so nobody goes looking for a toast system. */
  function setImportNotice(message: string, type: 'success' | 'error' | 'warning' | 'info' = 'info') {
    setNotice({ bad: type === 'error' || type === 'warning', text: message });
  }

  // --- Pedro Pathing (.pp) → sim coordinate transform ---
  const PP_FIELD_SIZE = 141.5;
  const PP_CENTER_OFFSET = PP_FIELD_SIZE / 2; // 70.75
  const SIM_FIELD_SIZE = 144; // From -72 to 72
  const SCALE_FACTOR = SIM_FIELD_SIZE / PP_FIELD_SIZE;

  function transformPpCoordinate(coord: Vec2): Vec2 {
    return {
      x: (coord.x - PP_CENTER_OFFSET) * SCALE_FACTOR,
      y: (coord.y - PP_CENTER_OFFSET) * SCALE_FACTOR,
    };
  }
  function transformPathPoint(pathPoint: PathPoint): PathPoint {
    const transformed = transformPpCoordinate(pathPoint);
    return { ...pathPoint, x: transformed.x, y: transformed.y };
  }

  function normalizeLines(input: PathLine[] = []): PathLine[] {
    return (input || []).map((line) => ({
      ...line,
      id: line.id || `line-${Math.random().toString(36).slice(2)}`,
      waitBeforeMs: Math.max(0, Number(line.waitBeforeMs ?? (line as any).waitBefore?.durationMs ?? 0)),
      waitAfterMs: Math.max(0, Number(line.waitAfterMs ?? (line as any).waitAfter?.durationMs ?? 0)),
      waitBeforeName: line.waitBeforeName ?? (line as any).waitBefore?.name ?? '',
      waitAfterName: line.waitAfterName ?? (line as any).waitAfter?.name ?? '',
      endPoint: transformPathPoint(line.endPoint),
      controlPoints: line.controlPoints?.map((cp) => transformPpCoordinate(cp)),
    }));
  }

  function deriveSequence(data: any, normalizedLines: PathLine[]): SequenceItem[] {
    if (Array.isArray(data?.sequence) && data.sequence.length) {
      return data.sequence as SequenceItem[];
    }
    return normalizedLines.map((ln) => ({ kind: 'path', lineId: ln.id! }));
  }

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    // clear the LAST import's line first. It was only ever set, never cleared, so a
    // failed import's red line sat under the section for the rest of the session.
    setNotice(null);
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.pp')) {
      setImportNotice('Pick a .pp file.', 'error');
      event.target.value = '';
      return;
    }
    if (settings.savedAutos.length >= MAX_SAVED_AUTOS) {
      setImportNotice(`You can save up to ${MAX_SAVED_AUTOS} autos. Delete one first.`, 'warning');
      event.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const data = JSON.parse(content);
        if (!data.startPoint || !data.lines) {
          throw new Error('Invalid file format: missing required fields (startPoint or lines)');
        }
        const transformedStartPoint = transformPathPoint(data.startPoint);
        const normalizedLines = normalizeLines(data.lines || []);
        const autoPathData: AutoPathData = {
          fileName: file.name,
          startPoint: transformedStartPoint,
          lines: normalizedLines,
          sequence: deriveSequence(data, normalizedLines),
          version: data.version,
          timestamp: data.timestamp,
        };
        // add to the library AND select it as the active auto
        set({
          savedAutos: [...settings.savedAutos, autoPathData],
          autoPath: autoPathData,
          autoPathEnabled: true,
        });
        setImportNotice(`Saved ${file.name}.`, 'success');
      } catch (error) {
        const errMsg = getErrorMessage(error);
        const message = errMsg.includes('Invalid file format')
          ? 'That isn’t a Pedro Pathing file.'
          : `Couldn’t read that file. ${errMsg}`;
        setImportNotice(message, 'error');
      } finally {
        event.target.value = '';
      }
    };
    reader.onerror = () => {
      setImportNotice('Couldn’t read that file.', 'error');
      event.target.value = '';
    };
    reader.readAsText(file);
  };

  // select a saved auto as the active one (a copy stays in the library)
  const selectAuto = (a: AutoPathData) => set({ autoPath: a, autoPathEnabled: true });
  const deleteAuto = (i: number) => {
    const removed = settings.savedAutos[i];
    const savedAutos = settings.savedAutos.filter((_, j) => j !== i);
    const wasActive = !!removed && settings.autoPath?.fileName === removed.fileName;
    set(wasActive ? { savedAutos, autoPath: null, autoPathEnabled: false } : { savedAutos });
  };

  const setAlliance = (alliance: Alliance) => set({ alliance });
  // the start-position editor is built on DECODE's G304 legality + goal geometry —
  // hidden for the Chain Reaction shell (its start rules arrive with its manual).
  const isDecode = settings.game === 'decode';
  // a game that brings its own start editor supplies it through the module slot;
  // absent ⇒ the two inline branches below (DECODE's and CR's), unchanged
  const StartEd = moduleFor(settings.game).startEditor;
  // the saved-pose cap a game's own editor is handed (it cannot read the ads context itself)
  const maxSaved = savedStartCap(useAds().supporter);
  // an auto path only DOES something in a game whose step drives path traversal
  // (`autoPaths`, today DECODE alone). The section used to be shown for every game, so a
  // CR/BIOBUZZ player could import a `.pp`, see "Auto path ON", and then watch their robot
  // do nothing for the whole autonomous period. `coerceSetup` drops the path at spawn.
  const runsAutoPaths = moduleFor(settings.game).autoPaths;
  // BIOBUZZ 3D SEAM (Day 1, `docs/biobuzz/plan-3d.md` §2.1/§6): only a game whose sim can
  // actually step the second physics offers the picker — absent `physicsOptions` (DECODE,
  // Chain Reaction) reads as `['2d']` only, so this never shows for them.
  const physicsOptions = moduleFor(settings.game).physicsOptions;
  // OPPONENTS (plan §6). The tier list is the GAME's (`GameSimModule.bot.tiers`) — opaque
  // strings, so a game can add or rename a difficulty without this file changing — and its
  // absence is what hides the control for DECODE and Chain Reaction.
  const botDriver = moduleFor(settings.game).bot;
  const botTiers = botDriver?.tiers;
  // WHICH BUTTON IS PRESSED, resolved through this game's own `coerceTier`: the stored string
  // may be another game's word for a difficulty (it is kept verbatim across a game that has no
  // driver — see `coerceSettings`), and an unrecognised one must light the tier that would
  // actually be played rather than none at all.
  const activeBotTier =
    !botDriver || (settings.practiceBots ?? 'off') === 'off'
      ? 'off'
      : botDriver.coerceTier(settings.practiceBots);

  return (
    <section className="ds-panel">
      <div className="ds-panel-h">
        <span className="ds-panel-title">Match setup</span>
      </div>

      <div className="ds-panel-body stack">
        <section className="ds-sec">
          <h2>Alliance</h2>
          {/* ALL CAPS here is the deliberate one `docs/area/ui.md` records: an alliance reads
              RED and BLUE on the FTC scoring display and in this app's own HUD chips, and a
              sentence-case alliance would be the only place in DSIM that disagrees. */}
          <div className="ds-opts two">
            <button
              className={`ds-opt red ${settings.alliance === 'red' ? 'on' : ''}`}
              aria-pressed={settings.alliance === 'red'}
              onClick={() => setAlliance('red')}
            >
              <span className="ot">RED</span>
            </button>
            <button
              className={`ds-opt blue ${settings.alliance === 'blue' ? 'on' : ''}`}
              aria-pressed={settings.alliance === 'blue'}
              onClick={() => setAlliance('blue')}
            >
              <span className="ot">BLUE</span>
            </button>
          </div>
        </section>

        <section className="ds-sec">
          <h2>Start position</h2>
          {StartEd ? (
            <StartEd
              maxSaved={maxSaved}
              spec={settings.spec}
              alliance={settings.alliance}
              value={settings.startPose}
              startIndex={settings.startIndex ?? 0}
              category={settings.startCat}
              saved={settings.savedStartPoses}
              onChange={(startPose) => startPose && set(selectStart(settings, { index: -1, pose: startPose }))}
              onPickPreset={(i) => set(selectStart(settings, { index: i, pose: null }))}
              onCategory={(c) => set(switchCategory(settings, c))}
              onSave={(pose) => set(saveStart(settings, pose))}
              onDeleteSaved={(c, i) => set(deleteSavedStart(settings, c, i))}
            />
          ) : isDecode ? (
            <StartPositionEditor
              spec={settings.spec}
              alliance={settings.alliance}
              value={settings.startPose}
              startIndex={settings.startIndex}
              category={settings.startCat}
              saved={settings.savedStartPoses}
              onChange={(startPose) => startPose && set(selectStart(settings, { index: -1, pose: startPose }))}
              onPickPreset={(i) => set(selectStart(settings, { index: i, pose: null }))}
              onCategory={(c) => set(switchCategory(settings, c))}
              onSave={(pose) => set(saveStart(settings, pose))}
              onDeleteSaved={(c, i) => set(deleteSavedStart(settings, c, i))}
            />
          ) : (
            <ChainStartEditor
              spec={settings.spec}
              alliance={settings.alliance}
              value={settings.startPose}
              startIndex={settings.startIndex ?? 0}
              category={settings.startCat}
              saved={settings.savedStartPoses}
              onChange={(startPose) => set(selectStart(settings, { index: -1, pose: startPose }))}
              onPickPreset={(i) => set(selectStart(settings, { index: i, pose: null }))}
              onCategory={(c) => set(switchCategory(settings, c))}
              onSave={(pose) => set(saveStart(settings, pose))}
              onDeleteSaved={(c, i) => set(deleteSavedStart(settings, c, i))}
            />
          )}
        </section>

        {/* ---------- WHO ELSE IS ON THE FIELD ----------
            Both of these used to hang off the `Start position` heading, along with the physics
            picker and a second copy of the 3D view toggle, because that is the order they were
            added in. Neither is a start position. */}
        <section className="ds-sec">
          <h2>Opponents</h2>
            {/* OPPONENTS (plan §6): fill the empty seats of the format with AI drivers, at a tier
                this game names itself. The row is absent for a game with no `bot` driver —
                offering difficulties nothing can play is worse than offering nothing. Solo
                PRACTICE only: free drive has no match for a bot to play. */}
            {botTiers && settings.mode === 'match' && (
              <OptRow<string>
                label="AI drivers"
                value={activeBotTier}
                onPick={(t) => set({ practiceBots: t })}
                options={[{ v: 'off', t: 'None' }, ...botTiers.map((t) => ({ v: t, t: botLabel(t) }))]}
              />
            )}
            {/* DUMMIES are a different thing from the bots on purpose: inert obstacles, and the
                only opponents free drive has. */}
          <ToggleRow
            label="Practice dummies"
            value={settings.practiceDummies}
            onPick={(practiceDummies) => set({ practiceDummies })}
          />
        </section>

        {/* BIOBUZZ 3D SEAM: which physics a SOLO practice steps on — absent reads '3d',
            the seam's default (`settings.ts`). Ranked/matchmade/record rooms always run
            3D; this picker only ever applies here.
            ⚠️ THE 2D/3D *VIEW* PICKER THAT USED TO SIT BESIDE IT IS GONE. It wrote the same
            per-device store as Graphics ▸ Field view, so there were two controls for one
            setting on two screens — and this file's own comment already said a Graphics
            section "replaces this control on Day 3". It did; this is the removal. */}
        {physicsOptions?.includes('3d') && (
          <section className="ds-sec">
            <h2>Practice physics</h2>
            <OptRow<'2d' | '3d'>
              value={settings.practicePhysics ?? '3d'}
              cols="two"
              onPick={(practicePhysics) => set({ practicePhysics })}
              options={[
                { v: '2d', t: '2D', d: 'Lighter on a slow machine' },
                { v: '3d', t: '3D', d: 'What ranked and record rooms run' },
              ]}
            />
          </section>
        )}

        {runsAutoPaths && (
        <section className="ds-sec">
          <h2>
            Auto path{' '}
            <span className="ds-count">
              {settings.savedAutos.length}/{MAX_SAVED_AUTOS}
            </span>
          </h2>
          <div className="ds-opts">
            {settings.savedAutos.map((a, i) => {
              const active = settings.autoPath?.fileName === a.fileName;
              return (
                <div
                  key={i}
                  className={`ds-opt ${active ? 'on' : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => selectAuto(a)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') selectAuto(a);
                  }}
                >
                  <button
                    className="ds-opt-del"
                    title="Delete this auto"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteAuto(i);
                    }}
                  >
                    ✕
                  </button>
                  <span className="ot">{a.fileName}</span>
                  <span className="od">
                    {a.lines?.length ?? 0} segments
                  </span>
                </div>
              );
            })}
            {settings.savedAutos.length < MAX_SAVED_AUTOS && (
              <label className="ds-opt ds-opt-add">
                <span className="ot">Import a .pp file</span>
                <input type="file" accept=".pp" onChange={handleFileChange} style={{ display: 'none' }} />
              </label>
            )}
          </div>
          {/* THE FILENAME IS THE LABEL. The row used to read "Auto path ON" with the name
              underneath, so the tile said what its own fill already said and the one thing
              the off state cannot otherwise tell you was demoted to a sub-line. */}
          {settings.autoPath && (
            <ToggleRow
              label={`Run ${settings.autoPath.fileName}`}
              value={settings.autoPathEnabled}
              onPick={(autoPathEnabled) => set({ autoPathEnabled })}
            />
          )}
          {notice && (
            <p className={notice.bad ? 'ds-form-err' : 'ds-hint'} role="status">
              {notice.text}
            </p>
          )}
          <p className="ds-hint">
            Build a <code>.pp</code> path at{' '}
            <a href="https://visualizer.pedropathing.com" target="_blank" rel="noreferrer">
              visualizer.pedropathing.com
            </a>
            .
          </p>
        </section>
        )}
      </div>
    </section>
  );
}
