import { useEffect, useRef } from 'react';

/**
 * Desktop shortcuts (spec §41, §42):
 *   Space = Start / Pause / Resume, Esc = Wipe, Left/Right = -0.5s / +0.5s.
 * Disabled while a text input has focus.
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
      if (event.defaultPrevented || event.repeat) return;
      if (isTextEntry(event.target)) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      switch (event.key) {
        case ' ':
        case 'Spacebar':
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
