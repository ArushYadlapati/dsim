import { ENDGAME_START } from '../config';
import type { HudSnapshot } from '../game';

/**
 * The score bar's TIMER PANEL state — one function, because a game that fills the `scoreBar`
 * slot draws its own bar and BIOBUZZ's copy had drifted: it lost the END GAME tint and said
 * FINAL beside a score that was still settling (design review 05-07 / 22-01). Every bar reads
 * its class, label and digits from here, so the two cannot disagree again.
 */
export function fmtTime(s: number): string {
  const total = Math.max(0, Math.ceil(s));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

const PHASE_LABEL: Record<HudSnapshot['phase'], string> = {
  pre: 'PRE-MATCH',
  auto: 'AUTONOMOUS',
  transition: 'TRANSITION',
  teleop: 'DRIVER-CONTROLLED',
  post: 'FINAL',
  freeplay: 'FREE DRIVE',
};

type TimerHud = Pick<HudSnapshot, 'phase' | 'timeLeft' | 'resultFinal'>;

export function timerPanel(hud: TimerHud): { cls: string; label: string; time: string } {
  const urgent = hud.timeLeft <= 10 && (hud.phase === 'auto' || hud.phase === 'teleop');
  const endgame = hud.timeLeft <= ENDGAME_START && hud.phase === 'teleop';
  return {
    cls: urgent ? 'urgent' : endgame ? 'warning' : '',
    // FINAL only once the score is final: between the buzzer and the field coming to rest it
    // can still change, and the bar must not call it FINAL beside it
    label: endgame
      ? 'END GAME'
      : hud.phase === 'post' && !hud.resultFinal
        ? 'MATCH OVER'
        : PHASE_LABEL[hud.phase],
    time: hud.phase === 'post' ? '0:00' : fmtTime(hud.timeLeft),
  };
}
