import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LibraryProvider } from '../../app/LibraryContext';
import { SettingsProvider } from '../../app/SettingsContext';
import { MemoryTimelineRepository } from '../../test/memoryRepository';
import type { TimelinePackage } from '../../timeline/types';
import { PlayerView } from './PlayerView';

const TIMELINE: TimelinePackage = {
  schemaVersion: 1,
  id: 'ui-test-timeline',
  meta: { name: 'UI Test', encounterId: 'ui-test' },
  encounter: { durationMs: 60_000, countdownMs: 15_000 },
  tracks: [
    {
      id: 'ui-track',
      type: 'encounter',
      name: 'Boss Mechanics',
      enabledByDefault: true,
      events: [
        {
          id: 'ui-event-pull',
          atMs: 0,
          name: 'Pull',
          category: 'mechanic',
          cues: [{ id: 'ui-cue-countdown', offsetMs: -2000, text: '兩秒後開始' }],
        },
        {
          id: 'ui-event-first',
          atMs: 10_000,
          name: 'First Mechanic',
          category: 'mechanic',
          cues: [{ id: 'ui-cue-first', offsetMs: 0, text: '第一次機制' }],
        },
      ],
    },
  ],
};

function renderPlayer() {
  const repository = new MemoryTimelineRepository([TIMELINE]);
  return render(
    <SettingsProvider>
      <LibraryProvider repository={repository}>
        <MemoryRouter initialEntries={[`/player/${TIMELINE.id}`]}>
          <Routes>
            <Route path="/player/:timelineId" element={<PlayerView mode="live" />} />
            <Route path="*" element={<div>elsewhere</div>} />
          </Routes>
        </MemoryRouter>
      </LibraryProvider>
    </SettingsProvider>,
  );
}

/** Flush pending promises (library load) without leaving fake-timer mode. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Drive the engine's 50ms scheduler and the faked performance clock. */
function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function click(element: HTMLElement) {
  act(() => {
    fireEvent.click(element);
  });
}

function startPull() {
  click(screen.getByRole('button', { name: '開始' }));
  const dialog = screen.getByRole('dialog');
  click(within(dialog).getByRole('button', { name: '開始' }));
}

describe('Player flow', () => {
  beforeEach(() => {
    localStorage.clear();
    // No built-in templates in tests: the manifest fetch fails and is ignored.
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('runs START -> countdown -> cue -> WIPE -> restart', async () => {
    renderPlayer();
    await flush();

    expect(screen.getByText('UI Test')).toBeInTheDocument();
    // Idle sits at -countdown.
    expect(screen.getByTestId('timer')).toHaveTextContent('-00:15.0');

    // START opens the Ready Summary (Quick Start is off by default).
    click(screen.getByRole('button', { name: '開始' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Boss Mechanics/)).toBeInTheDocument();
    click(within(dialog).getByRole('button', { name: '開始' }));

    expect(screen.getByText('倒數中')).toBeInTheDocument();

    // Negative-time cue fires during the countdown.
    advance(13_100);
    expect(screen.getByTestId('current-cue')).toHaveTextContent('兩秒後開始');

    // t = 0 switches to running.
    advance(2000);
    expect(screen.getByText('進行中')).toBeInTheDocument();

    // The 10s cue fires.
    advance(10_000);
    expect(screen.getByTestId('current-cue')).toHaveTextContent('第一次機制');

    // WIPE resets to idle without a second confirmation.
    click(screen.getByRole('button', { name: '滅團重置' }));
    expect(screen.getByTestId('timer')).toHaveTextContent('-00:15.0');
    expect(screen.getByText('待機')).toBeInTheDocument();
    expect(screen.getByTestId('current-cue')).toHaveTextContent('—');
    expect(screen.getByTestId('pull-offset')).toHaveTextContent('+0.0s');

    // Restart works and counts a new pull.
    startPull();
    advance(13_100);
    expect(screen.getByTestId('current-cue')).toHaveTextContent('兩秒後開始');
    // Header and the debug pull filter both mention it.
    expect(screen.getAllByText(/第 2 場/).length).toBeGreaterThan(0);
  });

  it('keeps the session offset across a wipe and clears the pull offset', async () => {
    renderPlayer();
    await flush();

    startPull();
    advance(1000);

    click(screen.getByRole('button', { name: '+0.5s' }));
    expect(screen.getByTestId('pull-offset')).toHaveTextContent('+0.5s');

    click(screen.getByRole('button', { name: '把本場偏移併入全域偏移' }));
    expect(screen.getByTestId('session-offset')).toHaveTextContent('+0.5s');
    expect(screen.getByTestId('pull-offset')).toHaveTextContent('+0.0s');

    click(screen.getByRole('button', { name: '滅團重置' }));
    expect(screen.getByTestId('session-offset')).toHaveTextContent('+0.5s');
    expect(screen.getByTestId('effective-offset')).toHaveTextContent('+0.5s');
  });
});
