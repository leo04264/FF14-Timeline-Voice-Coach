import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryTimelineRepository } from '../test/memoryRepository';
import { EXAMPLE_TIMELINE } from '../timeline/exampleTimeline';
import type { TimelinePackage } from '../timeline/types';
import { AUTOSAVE_DEBOUNCE_MS, HISTORY_LIMIT, useEditorState } from './useEditorState';

function rename(timeline: TimelinePackage, name: string): TimelinePackage {
  return { ...timeline, meta: { ...timeline.meta, name } };
}

describe('useEditorState', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces auto-save instead of writing on every keystroke', async () => {
    const repository = new MemoryTimelineRepository([EXAMPLE_TIMELINE]);
    const save = vi.spyOn(repository, 'save');
    const { result } = renderHook(() => useEditorState(repository));

    act(() => result.current.resetTimeline(EXAMPLE_TIMELINE));

    act(() => result.current.setTimeline(rename(EXAMPLE_TIMELINE, 'A')));
    act(() => result.current.setTimeline(rename(EXAMPLE_TIMELINE, 'AB')));
    act(() => result.current.setTimeline(rename(EXAMPLE_TIMELINE, 'ABC')));

    expect(save).not.toHaveBeenCalled();
    expect(result.current.saveStatus).toBe('editing');

    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0].meta.name).toBe('ABC');
    expect(result.current.saveStatus).toBe('saved');
  });

  it('undoes and redoes edits', () => {
    const repository = new MemoryTimelineRepository([EXAMPLE_TIMELINE]);
    const { result } = renderHook(() => useEditorState(repository));

    act(() => result.current.resetTimeline(EXAMPLE_TIMELINE));
    expect(result.current.canUndo).toBe(false);

    act(() => result.current.setTimeline(rename(EXAMPLE_TIMELINE, 'Edited')));
    expect(result.current.timeline?.meta.name).toBe('Edited');
    expect(result.current.canUndo).toBe(true);

    act(() => result.current.undo());
    expect(result.current.timeline?.meta.name).toBe(EXAMPLE_TIMELINE.meta.name);
    expect(result.current.canRedo).toBe(true);

    act(() => result.current.redo());
    expect(result.current.timeline?.meta.name).toBe('Edited');
  });

  it('keeps at least 50 undo steps', () => {
    const repository = new MemoryTimelineRepository([EXAMPLE_TIMELINE]);
    const { result } = renderHook(() => useEditorState(repository));

    act(() => result.current.resetTimeline(EXAMPLE_TIMELINE));
    for (let step = 1; step <= HISTORY_LIMIT; step += 1) {
      act(() => result.current.setTimeline(rename(EXAMPLE_TIMELINE, `step-${step}`)));
    }

    for (let step = HISTORY_LIMIT; step >= 2; step -= 1) {
      act(() => result.current.undo());
      expect(result.current.timeline?.meta.name).toBe(`step-${step - 1}`);
    }
  });

  it('saves drafts even when validation would block the player', async () => {
    const repository = new MemoryTimelineRepository([EXAMPLE_TIMELINE]);
    const broken: TimelinePackage = structuredClone(EXAMPLE_TIMELINE);
    broken.tracks[0].events[0].cues[0].text = '';

    const { result } = renderHook(() => useEditorState(repository));
    act(() => result.current.resetTimeline(EXAMPLE_TIMELINE));
    act(() => result.current.setTimeline(broken));

    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
    });

    const stored = await repository.get(EXAMPLE_TIMELINE.id);
    expect(stored?.status).toBe('valid');
    if (stored?.status === 'valid') expect(stored.report.hasBlockingError).toBe(true);
  });
});
