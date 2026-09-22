import { Suspense, lazy } from 'react';
import type { GameSettings } from '../game';
import { Menu } from './Menu';
import { MatchSetup } from './MatchSetup';
import { ControlsSection } from './ControlsSection';
import { AudioSection } from './AudioSection';
/**
 * LAZY, unlike its four siblings — and the reason is the bundle, not the screen.
 *
 * `GraphicsSection` carries the whole seventeen-setting model (`graphics/settings.ts`: the preset
 * table, the coercion, the store), which nothing else in the MAIN chunk reads — the renderer
 * reads it from the scene chunk, and the scene chunk is already lazy. Statically importing it
 * here put ~5 KB gzipped of 3D graphics settings into the bundle every player of every game
 * downloads, including the ones on DECODE who will never open a 3D view. `scripts/bundleaudit.mjs`
 * is the thing that would have caught it a week later; this is catching it now.
 *
 * The cost is one extra request the first time somebody opens `/configure/graphics`, behind a
 * `.ds-loading` line — the same state every list on the site already has.
 */
const GraphicsSection = lazy(() => import('./GraphicsSection').then((m) => ({ default: m.GraphicsSection })));

/**
 * TASK ORDER, not the order the sections were built in: build the robot, learn to drive it,
 * set up the session you will drive it in, then the two output settings. `match` moved from
 * second to third and nothing else changed position.
 *
 * ⚠️ THE ROUTE KEYS ARE UNTOUCHED. This array is the ORDER ON SCREEN; `/configure/<key>` is a
 * shipped, deep-linkable URL (`audio` is still the key for Audio and Visual), and reordering a
 * list must never break a link somebody has bookmarked.
 */
export const CONFIGURE_SECTIONS = ['robot', 'controls', 'match', 'audio', 'graphics'] as const;
export type ConfigureSection = (typeof CONFIGURE_SECTIONS)[number];

export function isConfigureSection(s: string | null): s is ConfigureSection {
  return s !== null && (CONFIGURE_SECTIONS as readonly string[]).includes(s);
}

/**
 * A HINT NAMES WHAT IS BEHIND THE LABEL; it never restates it, and it is not a table of
 * contents. `NavRail` settled this rule for the four top-level destinations and these five
 * were written before it: "Audio and Visual · Sounds, voice & theme" said the label again in
 * other words, and "Robot · Presets, build, intake" listed three of the section's six panels
 * — which is a promise that goes stale every time one is added.
 */
const LABELS: Record<ConfigureSection, { label: string; hint: string }> = {
  robot: { label: 'Robot', hint: 'Build, look, drive feel' },
  controls: { label: 'Controls', hint: 'Keyboard, gamepad, touch' },
  match: { label: 'Match', hint: 'Practice setup' },
  // route key stays 'audio' — /configure/audio is deep-linkable and already shipped
  audio: { label: 'Audio and Visual', hint: 'Follows your account' },
  // The one section that is NOT `GameSettings`: everything under it is per device
  // (`localStorage['decodesim.graphics']`), because a GPU is a property of the machine —
  // `docs/biobuzz/plan-3d.md` §4.4, and `GraphicsSection`'s own header. The hint is the
  // difference between the two, which is the thing neither label can carry and the one
  // question a player cannot answer by looking.
  graphics: { label: 'Graphics', hint: 'This device only' },
};

/**
 * Configure — everything you tune before a match, behind one destination with a
 * sub-nav. Each section is an EXISTING component, moved rather than rewritten:
 * `Menu` (the robot builder), `MatchSetup` (was a collapsed panel on Home), and
 * `ControlsSection` + `AudioSection` (were buried in Account). Account keeps only
 * identity, server region, and the settings reset.
 *
 * The active section is a real route (`/configure/<section>`), so it is
 * deep-linkable and survives back/forward.
 */
export function Configure({
  settings,
  onChange,
  section,
  onSection,
  onEditTouchControls,
  onTutorial,
}: {
  settings: GameSettings;
  onChange: (s: GameSettings) => void;
  section: ConfigureSection;
  onSection: (s: ConfigureSection) => void;
  /** launch Free Drive with the on-screen touch-control layout editor open */
  onEditTouchControls: () => void;
  /** run the tutorial (roadmap item 6); absent when the active game has no tutorial. */
  onTutorial?: () => void;
}) {
  return (
    <>
      <h1 className="ds-h1">Configure</h1>

      <div className="ds-subnav-layout">
        <nav className="ds-subnav" aria-label="Configure sections">
          {CONFIGURE_SECTIONS.map((s) => (
            <button
              key={s}
              className={`ds-subnav-btn${section === s ? ' on' : ''}`}
              aria-current={section === s ? 'page' : undefined}
              onClick={() => onSection(s)}
            >
              <span className="sl">{LABELS[s].label}</span>
              <span className="sh">{LABELS[s].hint}</span>
            </button>
          ))}
        </nav>

        <div className="ds-subnav-body">
          {section === 'robot' && <Menu settings={settings} onChange={onChange} />}
          {section === 'match' && <MatchSetup settings={settings} onChange={onChange} />}
          {section === 'controls' && (
            <ControlsSection
              bindings={settings.bindings}
              onChange={(bindings) => onChange({ ...settings, bindings })}
              onEditTouchControls={onEditTouchControls}
              onTutorial={onTutorial}
            />
          )}
          {section === 'audio' && <AudioSection settings={settings} onChange={onChange} />}
          {section === 'graphics' && (
            <Suspense fallback={<div className="ds-loading">Loading graphics settings…</div>}>
              <GraphicsSection />
            </Suspense>
          )}
        </div>
      </div>
    </>
  );
}
