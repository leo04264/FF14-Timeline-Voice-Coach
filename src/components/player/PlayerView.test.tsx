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
  encounter: { durationMs: 60_000, countdownMs: 16_000 },
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
            <Route path="/player/:timelineId" element={<PlayerView />} />
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
    // Idle sits at -countdown (16s is the default preset).
    expect(screen.getByTestId('timer')).toHaveTextContent('-00:16.0');

    // START opens the Ready Summary (Quick Start is off by default).
    click(screen.getByRole('button', { name: '開始' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Boss Mechanics/)).toBeInTheDocument();
    click(within(dialog).getByRole('button', { name: '開始' }));

    expect(screen.getByText('倒數中')).toBeInTheDocument();

    // Negative-time cue fires during the countdown.
    advance(14_100);
    expect(screen.getByTestId('current-cue')).toHaveTextContent('兩秒後開始');

    // t = 0 switches to running.
    advance(2000);
    expect(screen.getByText('進行中')).toBeInTheDocument();

    // The 10s cue fires.
    advance(10_000);
    expect(screen.getByTestId('current-cue')).toHaveTextContent('第一次機制');

    // WIPE resets to idle without a second confirmation.
    click(screen.getByRole('button', { name: '滅團重置' }));
    expect(screen.getByTestId('timer')).toHaveTextContent('-00:16.0');
    expect(screen.getByText('待機')).toBeInTheDocument();
    expect(screen.getByTestId('current-cue')).toHaveTextContent('—');
    expect(screen.getByTestId('pull-offset')).toHaveTextContent('+0.0s');

    // Restart works and counts a new pull.
    startPull();
    advance(14_100);
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

  it('uses Space to start, pause and resume without restarting the pull', async () => {
    renderPlayer();
    await flush();

    act(() => fireEvent.keyDown(window, { key: ' ' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('倒數中')).toBeInTheDocument();
    expect(screen.getAllByText(/第 1 場/).length).toBeGreaterThan(0);

    advance(1000);
    const pausedAt = screen.getByTestId('timer').textContent;
    act(() => fireEvent.keyDown(window, { key: ' ' }));
    expect(screen.getByText('已暫停')).toBeInTheDocument();
    advance(2000);
    expect(screen.getByTestId('timer')).toHaveTextContent(pausedAt ?? '');
    expect(screen.getAllByText(/第 1 場/).length).toBeGreaterThan(0);

    act(() => fireEvent.keyDown(window, { key: ' ' }));
    expect(screen.getByText('倒數中')).toBeInTheDocument();
    expect(screen.getAllByText(/第 1 場/).length).toBeGreaterThan(0);
  });

  it('uses the same primary button to pause and resume after starting', async () => {
    renderPlayer();
    await flush();

    startPull();
    expect(screen.getByRole('button', { name: '暫停' })).toBeEnabled();
    expect(screen.getAllByText(/第 1 場/).length).toBeGreaterThan(0);

    advance(1000);
    const pausedAt = screen.getByTestId('timer').textContent;
    click(screen.getByRole('button', { name: '暫停' }));
    expect(screen.getByText('已暫停')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '繼續' })).toBeEnabled();

    advance(2000);
    expect(screen.getByTestId('timer')).toHaveTextContent(pausedAt ?? '');
    click(screen.getByRole('button', { name: '繼續' }));
    expect(screen.getByText('倒數中')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '暫停' })).toBeEnabled();
    expect(screen.getAllByText(/第 1 場/).length).toBeGreaterThan(0);
  });

  it('shows Traditional Chinese job names and gives voice-test feedback', async () => {
    renderPlayer();
    await flush();

    expect(screen.getByRole('option', { name: '騎士（坦克）' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '測試語音引擎' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '試聽一句' })).not.toBeInTheDocument();

    click(screen.getByRole('button', { name: '播放測試語音' }));
    expect(screen.getByText('正在準備語音…')).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(2100);
      await Promise.resolve();
    });
    expect(screen.getByText(/已送出測試語音/)).toBeInTheDocument();
  });

  it('requires a manual wipe before starting again after completion', async () => {
    renderPlayer();
    await flush();

    act(() => fireEvent.keyDown(window, { key: ' ' }));
    advance(76_100); // 16s countdown + the full 60s encounter
    expect(screen.getByText('已結束')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '請先重置' })).toBeDisabled();

    act(() => fireEvent.keyDown(window, { key: ' ' }));
    expect(screen.getByText('已結束')).toBeInTheDocument();
    expect(screen.getAllByText(/第 1 場/).length).toBeGreaterThan(0);

    click(screen.getByRole('button', { name: '滅團重置' }));
    expect(screen.getByText('待機')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '開始' })).toBeEnabled();
  });
});
