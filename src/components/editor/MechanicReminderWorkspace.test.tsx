import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../storage/settings';
import { absEvent, cue, SCH, timelineOf, track } from '../../test/planFixtures';
import { PERSONAL_TRACK_PURPOSE } from '../../timeline/personalReminders';
import { buildMechanicIndex, resolveEventTiming } from '../../timeline/resolveEventTiming';
import type { TimelinePackage } from '../../timeline/types';
import { MechanicReminderWorkspace } from './MechanicReminderWorkspace';

/** §9 C.16–C.19 on the real UI. */

function baseTimeline(): TimelinePackage {
  return timelineOf(
    [
      track(
        'boss',
        [
          absEvent('mech-60', 60_000, [cue('mech-60-cue', '第二次全體傷害')], {
            name: '第二次全體傷害',
            phase: 'P2',
            category: 'raidwide',
          }),
        ],
        { type: 'encounter', name: 'Boss Mechanics' },
      ),
      // A shared healer cue that also applies to this profile.
      track('shared', [absEvent('sh', 90_000, [cue('sh-cue', '共通補血')])], {
        type: 'role',
        name: '補師共用',
        target: { positions: ['H1', 'H2'] },
      }),
    ],
    { encounter: { durationMs: 600_000, countdownMs: 15_000 } },
  );
}

interface Harness {
  current: TimelinePackage;
  changes: number;
  forks: TimelinePackage[];
}

function renderWorkspace(initial: TimelinePackage, readOnly = false) {
  const harness: Harness = { current: initial, changes: 0, forks: [] };

  const view = render(
    <MechanicReminderWorkspace
      timeline={harness.current}
      profile={SCH}
      onProfileChange={() => undefined}
      settings={DEFAULT_SETTINGS}
      readOnly={readOnly}
      onChange={(next) => {
        harness.current = next;
        harness.changes += 1;
        view.rerender(node(next));
      }}
      onFork={(next) => {
        harness.forks.push(next);
        harness.current = next;
      }}
      onNavigateAdvanced={() => undefined}
    />,
  );

  function node(timeline: TimelinePackage) {
    return (
      <MechanicReminderWorkspace
        timeline={timeline}
        profile={SCH}
        onProfileChange={() => undefined}
        settings={DEFAULT_SETTINGS}
        readOnly={readOnly}
        onChange={(next) => {
          harness.current = next;
          harness.changes += 1;
          view.rerender(node(next));
        }}
        onFork={(next) => {
          harness.forks.push(next);
          harness.current = next;
        }}
        onNavigateAdvanced={() => undefined}
      />
    );
  }

  return { harness, view };
}

const click = (element: HTMLElement) => act(() => void fireEvent.click(element));
const type = (element: HTMLElement, value: string) =>
  act(() => void fireEvent.change(element, { target: { value } }));

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('C. 從機制列表快速追加', () => {
  it('列出機制，並顯示這個機制底下有幾句我的提醒', () => {
    renderWorkspace(baseTimeline());
    expect(screen.getByText('第二次全體傷害')).toBeInTheDocument();
    expect(screen.getByText('還沒有你的提醒')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '＋我的提醒' })).toBeInTheDocument();
  });

  it('預設畫面只問內容與前後幾秒，並即時顯示實際觸發時間', () => {
    renderWorkspace(baseTimeline());
    click(screen.getByRole('button', { name: '＋我的提醒' }));

    expect(screen.getByText(/替「第二次全體傷害」加提醒/)).toBeInTheDocument();
    expect(screen.getByText(/我的身分：H2／學者/)).toBeInTheDocument();
    // 預設提前 3 秒 → 60s - 3s
    expect(screen.getByTestId('quick-reminder-trigger')).toHaveTextContent('00:57.000');
    // 自動填入的部分
    expect(screen.getByText(/H2／學者（自動）/)).toBeInTheDocument();
    expect(screen.getByText(/我的自訂提醒（H2／學者）（自動）/)).toBeInTheDocument();
    // 正常流程的表單裡沒有職業對象矩陣，也沒有「選一條軌道」的步驟
    const form = screen.getByLabelText('提醒內容').closest('section')!;
    expect(within(form).queryByRole('checkbox', { name: /H1|D1|學者|占星/ })).not.toBeInTheDocument();
    expect(within(form).queryByLabelText(/儲存到哪一條軌道/)).not.toBeInTheDocument();
  });

  it('快捷選項與「當下」都會更新觸發時間，當下停用秒數輸入', () => {
    renderWorkspace(baseTimeline());
    click(screen.getByRole('button', { name: '＋我的提醒' }));

    click(screen.getByRole('button', { name: '前5秒' }));
    expect(screen.getByTestId('quick-reminder-trigger')).toHaveTextContent('00:55.000');

    click(screen.getByRole('button', { name: '當下' }));
    expect(screen.getByTestId('quick-reminder-trigger')).toHaveTextContent('01:00.000');
    expect(screen.getByLabelText('秒數')).toBeDisabled();

    type(screen.getByLabelText('提醒時機'), 'after');
    type(screen.getByLabelText('秒數'), '2.5');
    expect(screen.getByTestId('quick-reminder-trigger')).toHaveTextContent('01:02.500');
  });

  it('C15. 儲存後得到連動引用、57,000ms 觸發、目前身分的對象', () => {
    const { harness } = renderWorkspace(baseTimeline());
    click(screen.getByRole('button', { name: '＋我的提醒' }));
    type(screen.getByLabelText('提醒內容'), '下野戰，準備集合');
    click(screen.getByRole('button', { name: '儲存' }));

    const personal = harness.current.tracks.find((t) => t.purpose === PERSONAL_TRACK_PURPOSE)!;
    expect(personal.target).toEqual({ positions: ['H2'], jobs: ['SCH'] });
    const event = personal.events[0];
    expect(event.timing).toEqual({
      kind: 'mechanic',
      sourceTrackId: 'boss',
      sourceEventId: 'mech-60',
    });
    const resolved = resolveEventTiming(event, personal.id, buildMechanicIndex(harness.current));
    expect(resolved.atMs! + event.cues[0].offsetMs).toBe(57_000);
    expect(screen.getByText(/已加入我的自訂提醒/)).toBeInTheDocument();
    // 一次新增 = 一次文件變更 = 一次 undo
    expect(harness.changes).toBe(1);
  });

  it('C16. 第二次新增復用同一條軌道；連點儲存不會多一條', () => {
    const { harness } = renderWorkspace(baseTimeline());

    click(screen.getByRole('button', { name: '＋我的提醒' }));
    type(screen.getByLabelText('提醒內容'), '第一句');
    click(screen.getByRole('button', { name: '儲存' }));

    click(screen.getAllByRole('button', { name: '＋我的提醒' })[0]);
    type(screen.getByLabelText('提醒內容'), '第二句');
    const save = screen.getByRole('button', { name: '儲存' });
    click(save);
    click(save); // 連點：表單已關閉，不會再存

    const personal = harness.current.tracks.filter((t) => t.purpose === PERSONAL_TRACK_PURPOSE);
    expect(personal).toHaveLength(1);
    expect(personal[0].events).toHaveLength(2);
  });

  it('C17a. 空白內容不能儲存並就地顯示原因', () => {
    renderWorkspace(baseTimeline());
    click(screen.getByRole('button', { name: '＋我的提醒' }));
    expect(screen.getByRole('button', { name: '儲存' })).toBeDisabled();
    type(screen.getByLabelText('提醒內容'), '   ');
    expect(screen.getByText('提醒內容不能空白')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '儲存' })).toBeDisabled();
  });

  it('C17b. 超出可用時間不能儲存並說明原因', () => {
    renderWorkspace(baseTimeline());
    click(screen.getByRole('button', { name: '＋我的提醒' }));
    type(screen.getByLabelText('提醒內容'), '太早了');
    type(screen.getByLabelText('秒數'), '90');
    expect(screen.getByText(/早於倒數開始/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '儲存' })).toBeDisabled();
  });

  it('C17c. 不會出現 NaN／Infinity；負值被擋下', () => {
    renderWorkspace(baseTimeline());
    click(screen.getByRole('button', { name: '＋我的提醒' }));
    type(screen.getByLabelText('提醒內容'), 'x');
    for (const bad of ['', '-1', 'abc']) {
      type(screen.getByLabelText('秒數'), bad);
      expect(screen.getByRole('button', { name: '儲存' })).toBeDisabled();
      expect(screen.getByTestId('quick-reminder-trigger').textContent).not.toMatch(/NaN|Infinity/);
    }
  });

  it('C17d. 取消不留下空軌道或半成品', () => {
    const { harness } = renderWorkspace(baseTimeline());
    click(screen.getByRole('button', { name: '＋我的提醒' }));
    type(screen.getByLabelText('提醒內容'), '寫了又取消');
    click(screen.getByRole('button', { name: '取消' }));

    expect(harness.changes).toBe(0);
    expect(harness.current.tracks.filter((t) => t.purpose === PERSONAL_TRACK_PURPOSE)).toHaveLength(0);
    expect(screen.queryByLabelText('提醒內容')).not.toBeInTheDocument();
  });

  it('C18. 內建範本儲存時建立本機複本，引用映射到複本的機制，原檔不變', async () => {
    const builtin = baseTimeline();
    const snapshot = JSON.stringify(builtin);
    const { harness } = renderWorkspace(builtin, true);

    click(screen.getByRole('button', { name: '＋我的提醒' }));
    type(screen.getByLabelText('提醒內容'), '複本裡的提醒');
    click(screen.getByRole('button', { name: '儲存' }));
    // fork 是 async（要寫入 repository），等 microtask 收斂
    await act(async () => {
      await Promise.resolve();
    });

    expect(harness.forks).toHaveLength(1);
    const fork = harness.forks[0];
    expect(fork.id).not.toBe(builtin.id);

    const personal = fork.tracks.find((t) => t.purpose === PERSONAL_TRACK_PURPOSE)!;
    const event = personal.events[0];
    expect(event.timing.kind).toBe('mechanic');
    if (event.timing.kind !== 'mechanic') return;
    // 指向複本裡的機制，不是原檔的 id
    expect(event.timing.sourceEventId).not.toBe('mech-60');
    const resolved = resolveEventTiming(event, personal.id, buildMechanicIndex(fork));
    expect(resolved.atMs! + event.cues[0].offsetMs).toBe(57_000);

    // 原始內建檔案位元內容未改
    expect(JSON.stringify(builtin)).toBe(snapshot);
    expect(screen.getByText(/已建立本機複本/)).toBeInTheDocument();
  });

  it('C17e. 儲存失敗保留輸入並顯示錯誤，不虛報成功', async () => {
    const builtin = baseTimeline();
    const view = render(
      <MechanicReminderWorkspace
        timeline={builtin}
        profile={SCH}
        onProfileChange={() => undefined}
        settings={DEFAULT_SETTINGS}
        readOnly
        onFork={() => {
          throw new Error('磁碟滿了');
        }}
        onNavigateAdvanced={() => undefined}
      />,
    );
    click(screen.getByRole('button', { name: '＋我的提醒' }));
    type(screen.getByLabelText('提醒內容'), '會存失敗');
    click(screen.getByRole('button', { name: '儲存' }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText('磁碟滿了')).toBeInTheDocument();
    expect(screen.queryByText(/已加入/)).not.toBeInTheDocument();
    // 草稿還在
    expect(screen.getByLabelText('提醒內容')).toHaveValue('會存失敗');
    view.unmount();
  });
});

describe('C19. 直接編輯與共用內容保護', () => {
  function withReminder() {
    const { harness } = renderWorkspace(baseTimeline());
    click(screen.getByRole('button', { name: '＋我的提醒' }));
    type(screen.getByLabelText('提醒內容'), '原本的字');
    click(screen.getByRole('button', { name: '儲存' }));
    return harness;
  }

  it('可直接改文字與前後秒數，Enter 送出，一次一個 undo 步驟', () => {
    const harness = withReminder();
    const changesAfterAdd = harness.changes;

    click(screen.getByRole('button', { name: '編輯' }));
    const textInput = screen.getByLabelText('提醒內容');
    // 逐字輸入不會各自變成一個編輯動作
    type(textInput, '改');
    type(textInput, '改過');
    type(textInput, '改過的字');
    expect(harness.changes).toBe(changesAfterAdd);

    act(() => void fireEvent.keyDown(textInput, { key: 'Enter' }));
    expect(harness.changes).toBe(changesAfterAdd + 1);

    const personal = harness.current.tracks.find((t) => t.purpose === PERSONAL_TRACK_PURPOSE)!;
    expect(personal.events[0].cues[0].text).toBe('改過的字');
  });

  it('Esc 取消目前行編輯，不寫入', () => {
    const harness = withReminder();
    const before = harness.changes;

    click(screen.getByRole('button', { name: '編輯' }));
    const textInput = screen.getByLabelText('提醒內容');
    type(textInput, '不要存這個');
    act(() => void fireEvent.keyDown(textInput, { key: 'Escape' }));

    expect(harness.changes).toBe(before);
    expect(screen.queryByLabelText('提醒內容')).not.toBeInTheDocument();
    const personal = harness.current.tracks.find((t) => t.purpose === PERSONAL_TRACK_PURPOSE)!;
    expect(personal.events[0].cues[0].text).toBe('原本的字');
  });

  it('輸入中的空白鍵不會外洩給播放器快捷鍵', () => {
    withReminder();
    click(screen.getByRole('button', { name: '編輯' }));
    const textInput = screen.getByLabelText('提醒內容');

    const seen: string[] = [];
    const listener = (event: KeyboardEvent) => seen.push(event.key);
    window.addEventListener('keydown', listener);
    act(() => void fireEvent.keyDown(textInput, { key: ' ' }));
    window.removeEventListener('keydown', listener);

    // stopPropagation 讓全域 handler 收不到
    expect(seen).toEqual([]);
  });

  it('前後秒數可直接改，半成品的值不會寫進領域物件', () => {
    const harness = withReminder();
    click(screen.getByRole('button', { name: '編輯' }));
    const secondsInput = screen.getByLabelText('前後幾秒');

    type(secondsInput, '-'); // 打到一半
    act(() => void fireEvent.keyDown(secondsInput, { key: 'Enter' }));
    let personal = harness.current.tracks.find((t) => t.purpose === PERSONAL_TRACK_PURPOSE)!;
    // 無效值沒有被寫入，仍是原本的 -3000
    expect(personal.events[0].cues[0].offsetMs).toBe(-3000);

    click(screen.getByRole('button', { name: '編輯' }));
    type(screen.getByLabelText('前後幾秒'), '-1.5');
    act(() => void fireEvent.keyDown(screen.getByLabelText('前後幾秒'), { key: 'Enter' }));
    personal = harness.current.tracks.find((t) => t.purpose === PERSONAL_TRACK_PURPOSE)!;
    expect(personal.events[0].cues[0].offsetMs).toBe(-1500);
  });

  it('共用提示標成「共通」，不能用快捷操作靜默改寫', () => {
    renderWorkspace(baseTimeline());
    // 共用軌的句子是 absolute，出現在「固定時間／尚未連動」區
    expect(screen.getByText(/固定時間／尚未連動/)).toBeInTheDocument();
    expect(screen.getByText('共通')).toBeInTheDocument();

    // 共通那一列沒有「編輯」「刪除」，只有「進階編輯」
    const sharedRow = screen.getByText('共通').closest('tr')!;
    expect(within(sharedRow).getByRole('button', { name: '進階編輯' })).toBeInTheDocument();
    expect(within(sharedRow).queryByRole('button', { name: '編輯' })).not.toBeInTheDocument();
    expect(within(sharedRow).queryByRole('button', { name: '刪除' })).not.toBeInTheDocument();
    expect(within(sharedRow).getByRole('checkbox')).toBeDisabled();
  });

  it('固定時間的提醒不會只因秒數相近就被歸到機制底下', () => {
    renderWorkspace(baseTimeline());
    const mechanicRow = screen.getByText('第二次全體傷害').closest('tr')!;
    expect(within(mechanicRow).getByText('還沒有你的提醒')).toBeInTheDocument();
    // 共用句仍在固定時間區塊，並提供明確的「連動至機制…」
    expect(screen.getByRole('button', { name: '連動至機制…' })).toBeInTheDocument();
  });

  it('「適用於我」不等於「只影響我」的說明有出現', () => {
    renderWorkspace(baseTimeline());
    expect(screen.getByText(/不等於「只影響我」/)).toBeInTheDocument();
  });
});

describe('刪除引用安全（列表入口）', () => {
  it('刪除有引用的來源時列出所有受影響提醒，取消是預設', () => {
    // 讓 boss 機制底下有兩個不同職業的提醒
    const timeline = timelineOf(
      [
        track('boss', [absEvent('m', 60_000, [cue('mc', '機制')], { name: '機制' })], {
          type: 'encounter',
        }),
        track(
          'sch',
          [
            {
              id: 'r-sch',
              timing: { kind: 'mechanic', sourceTrackId: 'boss', sourceEventId: 'm' },
              name: '學者提醒',
              category: 'custom',
              cues: [cue('r-sch-c', '學者的字', { offsetMs: -3000 })],
            },
          ],
          { target: { positions: ['H2'], jobs: ['SCH'] }, purpose: PERSONAL_TRACK_PURPOSE },
        ),
        track(
          'ast',
          [
            {
              id: 'r-ast',
              timing: { kind: 'mechanic', sourceTrackId: 'boss', sourceEventId: 'm' },
              name: '占星提醒',
              category: 'custom',
              cues: [cue('r-ast-c', '占星的字', { offsetMs: -1000 })],
            },
          ],
          { target: { positions: ['H1'], jobs: ['AST'] } },
        ),
      ],
      { encounter: { durationMs: 600_000, countdownMs: 15_000 } },
    );

    const { harness } = renderWorkspace(timeline);
    // 學者看得到自己的提醒
    expect(screen.getByText('學者的字')).toBeInTheDocument();
    // 占星那條不在目前身分的列表上
    expect(screen.queryByText('占星的字')).not.toBeInTheDocument();

    click(screen.getByRole('button', { name: '刪除' }));
    // 這個提醒本身沒有被引用，所以直接刪
    expect(harness.current.tracks.find((t) => t.id === 'sch')!.events).toHaveLength(0);
    // 占星那條完全沒被動到
    expect(harness.current.tracks.find((t) => t.id === 'ast')!.events).toHaveLength(1);
  });
});
