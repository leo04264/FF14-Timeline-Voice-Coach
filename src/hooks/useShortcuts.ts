import { useEffect, useRef } from 'react';

/**
 * Desktop shortcuts (spec §41, §42):
 *   Space = Start / Pause / Resume, Esc = Wipe, Left/Right = -0.5s / +0.5s.
 *
 * Disabled while a text input has focus, and while a modal owns the screen —
 * Space must never confirm a risk dialog (spec §4.6.4).
 */

export interface ShortcutHandlers {
  onTogglePlayback(): void;
  onWipe(): void;
  onNudge(deltaMs: number): void;
}

export const NUDGE_MS = 500;

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * Elements the browser activates on Space/Enter by itself.
 *
 * Handling the key here as well would run the action twice: once from this
 * listener on keydown and once from the synthetic `click` the browser fires on
 * keyup (spec §4.6.5).
 */
function isNativelyActivated(target: EventTarget | null, key: string): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY' || tag === 'LABEL') return true;
  if (target.getAttribute('role') === 'button') return true;
  // Checkboxes and radios also toggle on Space.
  return tag === 'INPUT' && (key === ' ' || key === 'Spacebar');
}

export function useShortcuts(options: {
  enabled: boolean;
  escWipe: boolean;
  handlers: ShortcutHandlers;
}): void {
  const { enabled, escWipe } = options;
  const handlersRef = useRef(options.handlers);
  handlersRef.current = options.handlers;

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      // `repeat` guards a held-down key from queueing several starts.
      if (event.defaultPrevented || event.repeat) return;
      if (isTextEntry(event.target)) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      switch (event.key) {
        case ' ':
        case 'Spacebar':
          if (isNativelyActivated(event.target, event.key)) return;
          event.preventDefault();
          handlersRef.current.onTogglePlayback();
          break;
        case 'Escape':
          if (!escWipe) return;
          event.preventDefault();
          handlersRef.current.onWipe();
          break;
        case 'ArrowLeft':
          event.preventDefault();
          handlersRef.current.onNudge(-NUDGE_MS);
          break;
        case 'ArrowRight':
          event.preventDefault();
          handlersRef.current.onNudge(NUDGE_MS);
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled, escWipe]);
}
