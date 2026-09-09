import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadPlayerPrefs,
  PrefsWriteError,
  pruneEnabledTrackIds,
  savePlayerPrefs,
} from './settings';
import { STORAGE_PREFIX } from './LocalStorageTimelineRepository';
import { AST, SCH } from '../test/planFixtures';

const TL = 'timeline-1';
const legacyKey = `${STORAGE_PREFIX}:player-prefs:${TL}`;
const claimKey = `${STORAGE_PREFIX}:player-prefs-claimed:${TL}`;
const ownKey = (position: string, job: string) =>
  `${STORAGE_PREFIX}:player-prefs:${TL}:${position}:${job}`;

describe('A6. 每個身分各自的軌道偏好', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('偏好按 timelineId + 站位 + 職業 分開儲存', () => {
    savePlayerPrefs(TL, SCH, { enabledTrackIds: ['sch-heal'] });
    savePlayerPrefs(TL, AST, { enabledTrackIds: ['ast-heal'] });

    expect(loadPlayerPrefs(TL, SCH).enabledTrackIds).toEqual(['sch-heal']);
    expect(loadPlayerPrefs(TL, AST).enabledTrackIds).toEqual(['ast-heal']);
    expect(localStorage.getItem(ownKey('H2', 'SCH'))).not.toBeNull();
    expect(localStorage.getItem(ownKey('H1', 'AST'))).not.toBeNull();
  });

  it('切換職業不會沿用另一個身分的選擇', () => {
    savePlayerPrefs(TL, SCH, { enabledTrackIds: ['sch-heal', 'sch-dps'] });
    expect(loadPlayerPrefs(TL, AST)).toEqual({});
  });

  it('舊的每時間軸偏好只被第一個開啟的身分繼承一次', () => {
    localStorage.setItem(legacyKey, JSON.stringify({ enabledTrackIds: ['legacy'], countdownMs: 5000 }));

    // 第一個身分繼承
    expect(loadPlayerPrefs(TL, SCH)).toEqual({ enabledTrackIds: ['legacy'], countdownMs: 5000 });
    expect(localStorage.getItem(claimKey)).toBe('H2:SCH');

    // 其他身分不會被重複套上
    expect(loadPlayerPrefs(TL, AST)).toEqual({});
    expect(loadPlayerPrefs(TL, { position: 'MT', job: 'PLD' })).toEqual({});

    // 同一個身分再讀還是拿得到（尚未寫入自己的 key 之前）
    expect(loadPlayerPrefs(TL, SCH).enabledTrackIds).toEqual(['legacy']);
  });

  it('舊 key 本身保留可讀，不會被刪掉', () => {
    localStorage.setItem(legacyKey, JSON.stringify({ enabledTrackIds: ['legacy'] }));
    loadPlayerPrefs(TL, SCH);
    savePlayerPrefs(TL, SCH, { enabledTrackIds: ['new'] });
    expect(localStorage.getItem(legacyKey)).not.toBeNull();
    expect(loadPlayerPrefs(TL, SCH).enabledTrackIds).toEqual(['new']);
  });

  it('自己的偏好優先於舊偏好', () => {
    localStorage.setItem(legacyKey, JSON.stringify({ enabledTrackIds: ['legacy'] }));
    savePlayerPrefs(TL, SCH, { enabledTrackIds: ['mine'] });
    expect(loadPlayerPrefs(TL, SCH).enabledTrackIds).toEqual(['mine']);
  });

  it('壞掉的儲存內容不會白屏也不會假成功', () => {
    for (const junk of ['not json', '[]', 'null', '{"enabledTrackIds":"nope"}', '{"countdownMs":"x"}']) {
      localStorage.setItem(ownKey('H2', 'SCH'), junk);
      expect(() => loadPlayerPrefs(TL, SCH)).not.toThrow();
      expect(loadPlayerPrefs(TL, SCH).enabledTrackIds ?? []).toEqual([]);
    }
    localStorage.setItem(ownKey('H2', 'SCH'), '{"enabledTrackIds":["a",1,null,"b"]}');
    expect(loadPlayerPrefs(TL, SCH).enabledTrackIds).toEqual(['a', 'b']);
  });

  it('儲存失敗會拋出可回報的錯誤（記憶體結果仍由呼叫端保留）', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
    expect(() => savePlayerPrefs(TL, SCH, { enabledTrackIds: ['x'] })).toThrow(PrefsWriteError);
  });

  it('失效的 track ID 不會殘留', () => {
    expect(pruneEnabledTrackIds(['a', 'gone', 'b'], ['a', 'b', 'c'])).toEqual(['a', 'b']);
    expect(pruneEnabledTrackIds([], ['a'])).toEqual([]);
  });

  it('每個群組選定的方案也存在偏好裡', () => {
    savePlayerPrefs(TL, SCH, { selectedOptions: { strategy: 'a' } });
    expect(loadPlayerPrefs(TL, SCH).selectedOptions).toEqual({ strategy: 'a' });
    localStorage.setItem(ownKey('H2', 'SCH'), '{"selectedOptions":{"strategy":123}}');
    expect(loadPlayerPrefs(TL, SCH).selectedOptions).toEqual({});
  });
});
