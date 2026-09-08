import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LibraryProvider } from '../../app/LibraryContext';
import { SettingsProvider } from '../../app/SettingsContext';
import { MemoryTimelineRepository } from '../../test/memoryRepository';
import { saveSettings, DEFAULT_SETTINGS } from '../../storage/settings';
import { absEvent, cue, timelineOf, track } from '../../test/planFixtures';
import type { TimelinePackage } from '../../timeline/types';
import { PlayerView } from './PlayerView';

/**
 * §9 B.9–B.13: every start entry point obeys the same rules, and nothing can add
 * two pulls.
 */

/** Boss track + a Paladin track, so the normal case has no risk warning. */
function cleanTimeline(): TimelinePackage {
  return timelineOf(
    [
      track('boss', [absEvent('b1', 10_000, [cue('b1c', '第一次機制')])], {
        type: 'encounter',
        name: 'Boss Mechanics',
      }),
      track('mine', [absEvent('m1', 20_000, [cue('m1c', '我的提醒')])], {
        type: 'job',
        name: 'MT 騎士',
        target: { positions: ['MT'], jobs: ['PLD'] },
      }),
    ],
    { id: 'clean', encounter: { durationMs: 60_000, countdownMs: 16_000 } },
  );
}

/** Two cues 500ms apart: a real collision in this run. */
function collidingTimeline(): TimelinePackage {
  return timelineOf(
    [
      track(
        'boss',
        [absEvent('b1', 10_000, [cue('b1c', '第一句'), cue('b1d', '第二句', { offsetMs: 500 })])],
        { type: 'encounter', name: 'Boss Mechanics' },
      ),
      track('mine', [absEvent('m1', 30_000, [cue('m1c', '我的提醒')])], {
        type: 'job',
        name: 'MT 騎士',
        target: { positions: ['MT'], jobs: ['PLD'] },
      }),
    ],
    { id: 'colliding', encounter: { durationMs: 60_000, countdownMs: 16_000 } },
  );
}

/** Nothing addresses MT/PLD: the plan has zero cues. */
function emptyForProfile(): TimelinePackage {
  return timelineOf(
    [
      track('ast', [absEvent('a1', 10_000, [cue('a1c', '占星的提示')])], {
        type: 'job',
        name: 'H1 占星',
        target: { positions: ['H1'], jobs: ['AST'] },
      }),
    ],
    { id: 'empty-profile', encounter: { durationMs: 60_000, countdownMs: 16_000 } },
  );
}

/** Two mutually exclusive options, both enabled by default. */
function conflictingTimeline(): TimelinePackage {
  return timelineOf(
    [
      track('boss', [absEvent('b1', 10_000, [cue('b1c', '機制')])], {
        type: 'encounter',
        name: 'Boss Mechanics',
      }),
      track('a', [absEvent('a1', 20_000, [cue('a1c', 'A 方案')])], {
        type: 'job',
        name: 'A 方案',
        target: { positions: ['MT'], jobs: ['PLD'] },
        selection: { groupId: 'g', optionId: 'a' },
      }),
      track('b', [absEvent('b2', 25_000, [cue('b2c', 'B 方案')])], {
        type: 'job',
        name: 'B 方案',
        target: { positions: ['MT'], jobs: ['PLD'] },
        selection: { groupId: 'g', optionId: 'b' },
      }),
    ],
    {
      id: 'conflicting',
      encounter: { durationMs: 60_000, countdownMs: 16_000 },
      selectionGroups: [
        { id: 'g', name: '打法', options: [{ id: 'a', name: 'A 方案' }, { id: 'b', name: 'B 方案' }] },
      ],
    },
  );
}

function renderPlayer(timeline: TimelinePackage) {
  const repository = new MemoryTimelineRepository([timeline]);
  return render(
    <SettingsProvider>
      <LibraryProvider repository={repository}>
        <MemoryRouter initialEntries={[`/player/${timeline.id}`]}>
          <Routes>
            <Route path="/player/:timelineId" element={<PlayerView />} />
            <Route path="*" element={<div>elsewhere</div>} />
          </Routes>
        </MemoryRouter>
      </LibraryProvider>
    </SettingsProvider>,
  );
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const click = (element: HTMLElement) => act(() => void fireEvent.click(element));
const space = (target: Window | Element = window, init: KeyboardEventInit = {}) =>
  act(() => void fireEvent.keyDown(target, { key: ' ', ...init }));

const startButton = () => screen.getByRole('button', { name: '開始' });
const pullText = () => screen.getAllByText(/第 \d+ 場/)[0].textContent ?? '';

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'],
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('B9/B10. 三個開始入口的規則一致', () => {
  it('正常情況：按鈕、空白鍵都出現一般開始摘要', async () => {
    renderPlayer(cleanTimeline());
    await flush();

    click(startButton());
    let dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('準備好了嗎？')).toBeInTheDocument();
    expect(within(dialog).getByTestId('preflight-cue-count')).toHaveTextContent('2 句');
    click(within(dialog).getByRole('button', { name: '取消' }));

    space();
    dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('準備好了嗎？')).toBeInTheDocument();
  });

  it('Quick Start 沒有警告時直接開始，有警告時仍必須確認', async () => {
    saveSettings({ ...DEFAULT_SETTINGS, quickStart: true });

    const { unmount } = renderPlayer(cleanTimeline());
    await flush();
    click(startButton());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('倒數中')).toBeInTheDocument();
    unmount();

    // 有需要確認的警告時，Quick Start 也不能略過
    renderPlayer(collidingTimeline());
    await flush();
    click(startButton());
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('有風險要確認')).toBeInTheDocument();
    expect(screen.queryByText('倒數中')).not.toBeInTheDocument();
    expect(pullText()).toContain('第 0 場');
  });

  it('零句：三個入口都阻擋，且不會啟動', async () => {
    saveSettings({ ...DEFAULT_SETTINGS, quickStart: true });
    renderPlayer(emptyForProfile());
    await flush();

    for (const trigger of [() => click(startButton()), () => space()]) {
      trigger();
      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByText('這一場還不能開始')).toBeInTheDocument();
      expect(within(dialog).queryByRole('button', { name: '開始' })).not.toBeInTheDocument();
      expect(within(dialog).getByText(/沒有任何會播放的提示/)).toBeInTheDocument();
      click(within(dialog).getByRole('button', { name: '關閉' }));
      expect(pullText()).toContain('第 0 場');
    }
  });

  it('互斥衝突：阻擋，並要求選定方案', async () => {
    renderPlayer(conflictingTimeline());
    await flush();

    click(startButton());
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('這一場還不能開始')).toBeInTheDocument();
    expect(within(dialog).getByText(/同時啟用了多個互斥選項/)).toBeInTheDocument();
    click(within(dialog).getByRole('button', { name: '關閉' }));

    // 選定 A 方案之後就能開始
    click(screen.getByRole('radio', { name: /A 方案/ }));
    click(startButton());
    expect(within(screen.getByRole('dialog')).getByText('準備好了嗎？')).toBeInTheDocument();
  });

  it('碰撞待確認：文字、時間差、來源與兩個動作都在畫面上', async () => {
    renderPlayer(collidingTimeline());
    await flush();

    click(startButton());
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('有風險要確認')).toBeInTheDocument();
    expect(within(dialog).getByText('「第一句」')).toBeInTheDocument();
    expect(within(dialog).getByText('「第二句」')).toBeInTheDocument();
    expect(within(dialog).getByText('相隔 500 毫秒')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '試播這段' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '前往調整' })).toBeInTheDocument();
    expect(within(dialog).getByText(/不代表真實語音一定會重疊/)).toBeInTheDocument();

    click(within(dialog).getByRole('button', { name: '了解風險，仍開始' }));
    expect(screen.getByText('倒數中')).toBeInTheDocument();
  });
});

describe('B11. 沒有任何路徑會重複開始', () => {
  it('彈窗開啟時空白鍵不會確認風險', async () => {
    renderPlayer(collidingTimeline());
    await flush();

    click(startButton());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    space();
    space();
    // 仍停在彈窗，沒有開始
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByText('倒數中')).not.toBeInTheDocument();
    expect(pullText()).toContain('第 0 場');
  });

  it('原生按鈕上的空白鍵不會 click＋全域 handler 雙啟動', async () => {
    renderPlayer(cleanTimeline());
    await flush();

    // 焦點在按鈕上按空白：瀏覽器會自己觸發 click，全域 handler 必須讓路
    const button = startButton();
    space(button);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // 真正的 click（瀏覽器在 keyup 時做的事）只開一次彈窗
    click(button);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('輸入框裡的空白鍵是正常輸入', async () => {
    renderPlayer(cleanTimeline());
    await flush();
    const input = screen.getByLabelText(/自訂/, { selector: 'input' });
    space(input);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('重複鍵事件（按住空白）不會排出兩場', async () => {
    renderPlayer(cleanTimeline());
    await flush();
    space(window, { repeat: true });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('快速雙擊開始只開一個彈窗，確認後只加一次 pullId', async () => {
    renderPlayer(cleanTimeline());
    await flush();

    const primary = startButton();
    click(primary);
    click(primary);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);

    const dialog = screen.getByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: '開始' });
    click(confirm);
    click(confirm); // 已經卸載／失效的第二次點擊
    expect(pullText()).toContain('第 1 場');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('B12/B13. 確認的有效範圍與場次計數', () => {
  it('彈窗開著時改動倒數 → 請求作廢，不會用舊計畫開始', async () => {
    renderPlayer(cleanTimeline());
    await flush();

    click(startButton());
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // 改倒數會讓這次請求失效：彈窗關閉，且沒有任何一場被開起來
    click(screen.getByRole('button', { name: '5 秒' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(pullText()).toContain('第 0 場');

    // 重新開始時是用新的倒數重新檢查
    click(startButton());
    expect(within(screen.getByRole('dialog')).getByText('5.0 秒')).toBeInTheDocument();
  });

  it('取消會讓待處理的開始請求失效', async () => {
    renderPlayer(cleanTimeline());
    await flush();
    click(startButton());
    click(within(screen.getByRole('dialog')).getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(pullText()).toContain('第 0 場');
  });

  it('重置會讓待處理的開始請求失效', async () => {
    renderPlayer(cleanTimeline());
    await flush();
    click(startButton());
    click(screen.getByRole('button', { name: '重置' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(pullText()).toContain('第 0 場');
  });

  it('pause／resume 不算新的一場；completed 必須先重置', async () => {
    renderPlayer(cleanTimeline());
    await flush();

    click(startButton());
    click(within(screen.getByRole('dialog')).getByRole('button', { name: '開始' }));
    expect(pullText()).toContain('第 1 場');

    act(() => void vi.advanceTimersByTime(1000));
    click(screen.getByRole('button', { name: '暫停' }));
    click(screen.getByRole('button', { name: '繼續' }));
    expect(pullText()).toContain('第 1 場');

    // 跑完之後空白鍵不會開新的一場
    act(() => void vi.advanceTimersByTime(80_000));
    expect(screen.getByText('已結束')).toBeInTheDocument();
    space();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(pullText()).toContain('第 1 場');

    // 重置之後才能再開一場
    click(screen.getByRole('button', { name: '重置' }));
    click(startButton());
    click(within(screen.getByRole('dialog')).getByRole('button', { name: '開始' }));
    expect(pullText()).toContain('第 2 場');
  });

  it('播放中不能換身分或軌道', async () => {
    renderPlayer(cleanTimeline());
    await flush();
    click(startButton());
    click(within(screen.getByRole('dialog')).getByRole('button', { name: '開始' }));

    const trackCheckbox = screen.getByRole('checkbox', { name: /Boss Mechanics/ });
    expect(trackCheckbox).toBeDisabled();
    expect(screen.getByRole('combobox', { name: /站位/ })).toBeDisabled();
  });
});

describe('軌道顯示與句數（§4.3 在真實畫面上）', () => {
  it('顯示「本次播放 X 句」與總數，且不適用的軌道收在可展開區塊', async () => {
    renderPlayer(cleanTimeline());
    await flush();
    expect(screen.getByTestId('plan-total')).toHaveTextContent('本次播放共 2 句');
    // Boss 軌與騎士軌各 1 句
    expect(screen.getAllByText(/本次播放 1 句/)).toHaveLength(2);
  });

  it('不適用的軌道不能勾選，並顯示原因', async () => {
    renderPlayer(emptyForProfile());
    await flush();
    const details = screen.getByText(/不適用的軌道/);
    expect(details).toBeInTheDocument();
    const checkbox = screen.getByRole('checkbox', { name: /H1 占星（不可選）/ });
    expect(checkbox).toBeDisabled();
    expect(screen.getByText(/和目前身分不符/)).toBeInTheDocument();
  });
});
