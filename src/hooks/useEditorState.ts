import { useCallback, useEffect, useRef, useState } from 'react';
import type { TimelineRepository } from '../storage/TimelineRepository';
import type { TimelinePackage } from '../timeline/types';

/**
 * Editor document state: undo/redo (spec §61) plus debounced auto-save
 * (spec §62) and a save-status indicator (spec §63).
 *
 * Auto-save runs even when the timeline has validation errors — the draft is
 * always preserved; the player and formal export are what get blocked (§79).
 */

export const HISTORY_LIMIT = 50;
export const AUTOSAVE_DEBOUNCE_MS = 500;

export type SaveStatus = 'idle' | 'editing' | 'saving' | 'saved' | 'failed';

export interface EditorState {
  timeline: TimelinePackage | null;
  /** Apply an edit and push an undo step. */
  setTimeline(next: TimelinePackage): void;
  /** Replace the document without creating an undo step (initial load). */
  resetTimeline(next: TimelinePackage | null): void;
  undo(): void;
  redo(): void;
  canUndo: boolean;
  canRedo: boolean;
  saveStatus: SaveStatus;
  saveError: string | null;
  saveNow(): Promise<void>;
}

export function useEditorState(repository: TimelineRepository): EditorState {
  const [timeline, setTimelineState] = useState<TimelinePackage | null>(null);
  const [historyDepth, setHistoryDepth] = useState({ past: 0, future: 0 });
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  const timelineRef = useRef<TimelinePackage | null>(null);
  const pastRef = useRef<TimelinePackage[]>([]);
  const futureRef = useRef<TimelinePackage[]>([]);
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const syncHistoryDepth = useCallback(() => {
    setHistoryDepth({ past: pastRef.current.length, future: futureRef.current.length });
  }, []);

  const persist = useCallback(
    async (value: TimelinePackage) => {
      setSaveStatus('saving');
      try {
        await repository.save(value);
        setSaveError(null);
        setSaveStatus('saved');
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : 'Save failed');
        setSaveStatus('failed');
      }
    },
    [repository],
  );

  const scheduleSave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const value = timelineRef.current;
      if (!value || !dirtyRef.current) return;
      dirtyRef.current = false;
      void persist(value);
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [persist]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const apply = useCallback(
    (next: TimelinePackage) => {
      timelineRef.current = next;
      setTimelineState(next);
      dirtyRef.current = true;
      setSaveStatus('editing');
      scheduleSave();
    },
    [scheduleSave],
  );

  const setTimeline = useCallback(
    (next: TimelinePackage) => {
      const previous = timelineRef.current;
      if (previous) {
        pastRef.current = [...pastRef.current, previous].slice(-HISTORY_LIMIT);
        futureRef.current = [];
        syncHistoryDepth();
      }
      apply(next);
    },
    [apply, syncHistoryDepth],
  );

  const resetTimeline = useCallback(
    (next: TimelinePackage | null) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      timelineRef.current = next;
      pastRef.current = [];
      futureRef.current = [];
      dirtyRef.current = false;
      setTimelineState(next);
      syncHistoryDepth();
      setSaveStatus('idle');
      setSaveError(null);
    },
    [syncHistoryDepth],
  );

  const undo = useCallback(() => {
    const previous = pastRef.current[pastRef.current.length - 1];
    if (!previous) return;
    const current = timelineRef.current;
    pastRef.current = pastRef.current.slice(0, -1);
    if (current) futureRef.current = [current, ...futureRef.current].slice(0, HISTORY_LIMIT);
    syncHistoryDepth();
    apply(previous);
  }, [apply, syncHistoryDepth]);

  const redo = useCallback(() => {
    const next = futureRef.current[0];
    if (!next) return;
    const current = timelineRef.current;
    futureRef.current = futureRef.current.slice(1);
    if (current) pastRef.current = [...pastRef.current, current].slice(-HISTORY_LIMIT);
    syncHistoryDepth();
    apply(next);
  }, [apply, syncHistoryDepth]);

  const saveNow = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const value = timelineRef.current;
    if (!value) return;
    dirtyRef.current = false;
    await persist(value);
  }, [persist]);

  return {
    timeline,
    setTimeline,
    resetTimeline,
    undo,
    redo,
    canUndo: historyDepth.past > 0,
    canRedo: historyDepth.future > 0,
    saveStatus,
    saveError,
    saveNow,
  };
}

export const SAVE_STATUS_LABEL: Record<SaveStatus, string> = {
  idle: '',
  editing: 'Editing…',
  saving: 'Saving…',
  saved: 'Saved',
  failed: 'Save failed',
};
