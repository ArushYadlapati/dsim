import { useEffect, useReducer, useRef, useState } from 'react';
import type { HudSnapshot } from '../game';
import type { InputManager } from '../input/input';
import type { MobileLayout, RobotSpec } from '../types';
import {
  TOUCH_JOY_MAX_RADIUS,
  packTouchControls,
  touchLiveOf,
  touchReady,
  visibleTouchButtons,
  type PlacedTouchButton,
  type TouchButton,
} from './mobileActions';
import { getViewPref, subscribeViewPref } from '../games/biobuzz/graphics/store';
import { installViewKey, toggleViewPref } from '../games/biobuzz/graphics/viewKey';

type Which = 'drive' | 'turn';
interface StickRT {
  active: boolean;
  touchId: number | null;
  bx: number; // base centre (screen px) while active
  by: number;
  hx: number; // handle offset from base
  hy: number;
}
const idleStick = (): StickRT => ({ active: false, touchId: null, bx: 0, by: 0, hx: 0, hy: 0 });

/** viewport size, re-read on resize + orientation change. The pad arranges itself against it
 *  (`packTouchControls`), so a rotation re-lays the whole thing out rather than reinterpreting
 *  a fraction that was only ever right one way up. */
function useViewport(): { w: number; h: number } {
  const [vp, setVp] = useState(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 800,
    h: typeof window !== 'undefined' ? window.innerHeight : 600,
  }));
  useEffect(() => {
    const on = (): void => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', on);
    window.addEventListener('orientationchange', on);
    return () => {
      window.removeEventListener('resize', on);
      window.removeEventListener('orientationchange', on);
    };
  }, []);
  return vp;
}

/** one action button. Hold-style in play; draggable in edit if it has a stored slot.
 *
 * `idle` (a press would do nothing right now) rides the ARIA label and the `.idle` ghosting,
 * never the drawn label: `label` renders INSIDE the circle, so a suffix there wraps and
 * overflows it. An idle button still takes its press — see `touchReady`. */
function ActionButton({
  label,
  aria,
  idle,
  glyph,
  cls,
  size,
  left,
  top,
  editing,
  draggable,
  onDown,
  onUp,
  onDrag,
  onDragEnd,
}: {
  label: string;
  aria: string;
  idle?: boolean;
  glyph: string;
  cls: string;
  size: number;
  left: number;
  top: number;
  editing: boolean;
  draggable: boolean;
  onDown: () => void;
  onUp: () => void;
  onDrag: (clientX: number, clientY: number) => void;
  onDragEnd: () => void;
}) {
  const [pressed, setPressed] = useState(false);
  const dragging = useRef(false);
  // POSITION AND SIZE ONLY — the type scale is `.mobile-btn` / `.mobile-btn.shoot`
  // in the sheet, where the colours already live (`.mb-ico`/`.mb-lbl` size off it in em).
  const style: React.CSSProperties = { left, top, width: size, height: size };
  const full = idle ? `${aria} (not available now)` : aria;
  if (editing) {
    // A button with no `mobileLayout` key of its own arranges itself, so it is drawn but not
    // grabbable: the solid edge against the draggable ones' dashed edge is what says which is
    // which, and the ARIA label says it in words.
    if (!draggable) {
      return (
        <div className={`mobile-btn ${cls} fixed`} style={style} role="img" aria-label={`${full} (fixed position)`}>
          <span className="mb-ico" aria-hidden>
            {glyph}
          </span>
          <span className="mb-lbl">{label}</span>
        </div>
      );
    }
    return (
      <button
        type="button"
        className={`mobile-btn ${cls} editing`}
        style={style}
        onPointerDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
          dragging.current = true;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (dragging.current) onDrag(e.clientX, e.clientY);
        }}
        onPointerUp={(e) => {
          dragging.current = false;
          (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
          onDragEnd();
        }}
        aria-label={`${full} (drag to move)`}
      >
        <span className="mb-ico" aria-hidden>
          {glyph}
        </span>
        <span className="mb-lbl">{label}</span>
      </button>
    );
  }
  const down = (e: React.TouchEvent): void => {
    e.stopPropagation();
    setPressed(true);
    onDown();
  };
  const up = (e: React.TouchEvent): void => {
    e.stopPropagation();
    setPressed(false);
    onUp();
  };
  return (
    <button
      type="button"
      className={`mobile-btn ${cls}${idle ? ' idle' : ''}${pressed ? ' pressed' : ''}`}
      style={style}
      onTouchStart={down}
      onTouchEnd={up}
      onTouchCancel={up}
      aria-label={full}
      aria-disabled={idle || undefined}
    >
      <span className="mb-ico" aria-hidden>
        {glyph}
      </span>
      <span className="mb-lbl">{label}</span>
    </button>
  );
}

export function MobileControls({
  inputManager,
  hud,
  spec,
  layout,
  editing = false,
  onLayoutChange,
}: {
  inputManager: InputManager;
  /**
   * the live HUD, or null before its first poll. It answers both of the pad's questions
   * (`mobileActions.ts`): its game and the local robot's ASSISTS decide which buttons exist
   * (`ACTION_GAMES`, then `present`), and the rest decides which of them are idle right now.
   * No buttons are drawn until it arrives, so a pad never flashes INTAKE for the 100 ms before
   * the assists are known and then takes it away.
   */
  hud: HudSnapshot | null;
  /**
   * the local build. Every `present` predicate asks it — "does this robot have the
   * mechanism" — so a claw-only Chain Reaction build gets no THROW and a single-turret
   * BIOBUZZ build gets no place-NECTAR. It is the player's own spec rather than anything off
   * the wire because that is what they spawned with in every mode this pad renders in.
   */
  spec: RobotSpec;
  /** editable touch-control layout (centres as viewport fractions) */
  layout: MobileLayout;
  /** edit mode: drag controls to reposition instead of driving */
  editing?: boolean;
  /** called (on drag release) with the new layout to persist */
  onLayoutChange?: (l: MobileLayout) => void;
}) {
  const vp = useViewport();
  const scale = layout.scale;

  /**
   * THE 2D ⇄ 3D TOGGLE (plan-3d.md §4.3: "a `view` key in `MobileLayout`").
   *
   * A phone has no `t` key, so the touch layer needs a control of its own — and this is the one
   * surface where the 3D view's default camera is already the overhead shot
   * (`GameController.sceneCameraFor` returns `'overhead'` on a coarse pointer), so switching is
   * a genuine choice between two readable pictures rather than a downgrade.
   *
   * It is NOT part of the draggable `MobileLayout`, deliberately: a layout key would mean a new
   * field in `src/types.ts` and a settings migration, on another lane's files, for a button that
   * is pressed twice a session. It is pinned to the top strip instead — the band `onTouchStart`
   * already refuses to start a drive stick in ("leave the top strip for chips / menu"), so it
   * cannot be hit by a thumb reaching for the joystick.
   *
   * Hidden while EDITING the layout: everything else on that screen is draggable and a fixed
   * control among them reads as one that will not move.
   */
  const [view, setView] = useState(() => getViewPref());
  useEffect(() => subscribeViewPref(setView), []);
  // the key is reference-counted, so holding it here costs nothing on a device that has no
  // keyboard and works immediately on one that does (a tablet with a case, a Chromebook in
  // tablet mode) without waiting on a mount somewhere else
  useEffect(() => installViewKey(), []);
  const game = hud?.game ?? 'decode';
  const showView = !editing && game === 'biobuzz';

  // live-editable working copy while in edit mode (persist on release)
  const [edit, setEdit] = useState<MobileLayout>(layout);
  useEffect(() => {
    setEdit(layout);
  }, [layout, editing]);
  const L = editing ? edit : layout;

  // joystick runtime lives in a ref (touch matching) + a force-render tick
  const sticks = useRef<{ drive: StickRT; turn: StickRT }>({ drive: idleStick(), turn: idleStick() });
  const [, force] = useReducer((n: number) => n + 1, 0);

  const maxR = TOUCH_JOY_MAX_RADIUS * scale;

  // WHICH BUTTONS, AND WHERE. Both are derived — the set from `ACTION_GAMES` through the game's
  // own table, the arrangement from the live viewport — so a season that adds an action cannot
  // silently leave it unreachable on touch, and neither answer depends on the orientation the
  // player's stored layout happened to be tuned in.
  const buttons = hud
    ? visibleTouchButtons(game, {
        spec,
        autoIntake: hud.autoIntake,
        autoFire: hud.autoFire,
        fieldCentric: hud.fieldCentric,
        aimAssist: hud.aimAssist,
      })
    : [];
  const packed = packTouchControls(buttons, L, vp);
  // laying the pad out is not driving it: every button that exists is drawn live there
  const live = hud && !editing ? touchLiveOf(hud) : null;

  const onTouchStart = (e: React.TouchEvent): void => {
    if (editing) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.clientY < vp.h * 0.3) continue; // leave the top strip for chips / menu
      const which: Which = t.clientX < vp.w / 2 ? 'drive' : 'turn';
      const st = sticks.current[which];
      if (st.active) continue; // that stick already owns a finger
      sticks.current[which] = { active: true, touchId: t.identifier, bx: t.clientX, by: t.clientY, hx: 0, hy: 0 };
    }
    force();
  };

  const onTouchMove = (e: React.TouchEvent): void => {
    if (editing) return;
    for (let i = 0; i < e.touches.length; i++) {
      const t = e.touches[i];
      for (const which of ['drive', 'turn'] as Which[]) {
        const st = sticks.current[which];
        if (st.touchId !== t.identifier) continue;
        let dx = t.clientX - st.bx;
        let dy = t.clientY - st.by;
        const d = Math.hypot(dx, dy);
        if (d > maxR) {
          dx = (dx / d) * maxR;
          dy = (dy / d) * maxR;
        }
        st.hx = dx;
        st.hy = dy;
        const nx = dx / maxR;
        const ny = dy / maxR;
        if (which === 'drive') inputManager.setVirtualInput({ driveX: nx, driveY: -ny });
        else inputManager.setVirtualInput({ rotate: -nx });
      }
    }
    force();
  };

  const onTouchEnd = (e: React.TouchEvent): void => {
    if (editing) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      for (const which of ['drive', 'turn'] as Which[]) {
        if (sticks.current[which].touchId !== t.identifier) continue;
        if (which === 'drive') inputManager.setVirtualInput({ driveX: 0, driveY: 0 });
        else inputManager.setVirtualInput({ rotate: 0 });
        sticks.current[which] = idleStick();
      }
    }
    force();
  };

  // drag a control's HOME position in edit mode (clamped on-screen, persisted on release)
  const dragControl = (name: Exclude<keyof MobileLayout, 'scale'>, clientX: number, clientY: number): void => {
    const x = Math.max(0.04, Math.min(0.96, clientX / vp.w));
    const y = Math.max(0.06, Math.min(0.94, clientY / vp.h));
    setEdit((prev) => ({ ...prev, [name]: { x, y } }));
  };
  const commit = (): void => onLayoutChange?.(edit);

  /** a press on one button — held bits go on the command, taps fire one edge */
  const press = (b: TouchButton, down: boolean): void => {
    if (b.hold) inputManager.setVirtualInput({ [b.hold]: down } as never);
    else if (b.tap && down) inputManager.pressVirtual(b.tap);
  };

  // ---- joystick render (base at its packed home; floats to the finger while driving) ----
  const joystick = (which: Which): React.ReactNode => {
    const st = sticks.current[which];
    const home = packed[which];
    const cx = st.active ? st.bx : home.x;
    const cy = st.active ? st.by : home.y;
    const r = home.size / 2;
    const dragHandlers = editing
      ? {
          onPointerDown: (e: React.PointerEvent) => {
            e.stopPropagation();
            e.preventDefault();
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
          },
          onPointerMove: (e: React.PointerEvent) => {
            if (e.buttons || e.pressure > 0) dragControl(which, e.clientX, e.clientY);
          },
          onPointerUp: (e: React.PointerEvent) => {
            (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
            commit();
          },
        }
      : {};
    return (
      <div
        key={which}
        className={`mobile-joystick-base${st.active ? ' active' : ''}${editing ? ' editing' : ''}`}
        style={{ left: cx, top: cy, width: r * 2, height: r * 2 }}
        {...dragHandlers}
      >
        <div className="mobile-joystick-label">{which === 'drive' ? 'DRIVE' : 'TURN'}</div>
        <div
          className="mobile-joystick-handle"
          style={{
            width: r * 0.72,
            height: r * 0.72,
            transform: `translate(${st.hx}px, ${st.hy}px)`,
          }}
        />
      </div>
    );
  };

  const renderButton = (p: PlacedTouchButton): React.ReactNode => {
    const b = p.button;
    return (
      <ActionButton
        key={b.action}
        label={b.label}
        aria={b.aria}
        idle={live !== null && !touchReady(b, live)}
        glyph={b.glyph}
        cls={b.cls}
        size={p.size}
        left={p.x}
        top={p.y}
        editing={editing}
        draggable={b.slot !== undefined}
        onDown={() => press(b, true)}
        onUp={() => press(b, false)}
        onDrag={(cx, cy) => b.slot && dragControl(b.slot, cx, cy)}
        onDragEnd={commit}
      />
    );
  };

  return (
    <>
      {/* LOW-Z full-screen touch capture (below the HUD, so MENU/chips still work).
          Disabled in edit mode so the draggable controls own the pointer. */}
      <div
        className="mobile-touch"
        style={{ pointerEvents: editing ? 'none' : 'auto' }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      />
      {/* HIGH-Z visuals + buttons (above the scorebar, so nothing occludes them).
          pointer-events:none except the interactive children — `.hud` is pointer-events:none
          so the canvas keeps its drag, and anything in it that is meant to be pressed has to
          re-enable them ON ITSELF (docs/area/ui.md). `.mobile-btn` does. */}
      <div className="mobile-overlay">
        {showView && (
          <button
            className="game-btn mobile-view-btn"
            data-hud-band
            onClick={toggleViewPref}
            aria-pressed={view === '3d'}
          >
            {view === '3d' ? '3D' : '2D'}
          </button>
        )}
        {joystick('drive')}
        {joystick('turn')}
        {packed.buttons.map(renderButton)}
      </div>
    </>
  );
}
