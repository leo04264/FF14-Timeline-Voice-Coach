import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { migrateTimeline } from './migration';
import { parseTimelinePackage } from './schema';
import { buildPlaybackPlan } from './playbackPlan';
import { COUNTDOWN_PRESETS_MS, DEFAULT_SETTINGS } from '../storage/settings';
import { JOB_CODES, PARTY_POSITIONS, type PlayerProfile, type TimelinePackage } from './types';

/**
 * The regression this file exists for.
 *
 * `plan.cue-before-countdown` compares each cue against *this run's* countdown,
 * not the countdown the document declares. The player offers 5s / 10s presets,
 * and several shipped plans open with a cue well before the pull — M5S H2
 * Scholar starts with 秘策綠帽 at -15s — so picking 10s made a built-in
 * timeline impossible to start at all. The countdown preference is persisted
 * per identity, so once picked it stayed broken.
 *
 * Blocking is the intended behaviour (an opening cue must never be dropped
 * silently), so the fix is that the plan reports the countdown the run needs
 * and the player disables the presets that cannot work. These tests pin both
 * halves against the real shipped data.
 */

interface Builtin {
  file: string;
  timeline: TimelinePackage;
}

function loadBuiltins(): Builtin[] {
  const dir = 'public/timelines';
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json') && file !== 'index.json')
    .map((file) => {
      const migrated = migrateTimeline(JSON.parse(readFileSync(`${dir}/${file}`, 'utf8')));
      if (!migrated.ok) throw new Error(`${file}: ${migrated.error}`);
      const parsed = parseTimelinePackage(migrated.value);
      if (!parsed.ok) throw new Error(`${file}: ${parsed.issues?.[0]?.message ?? 'parse failed'}`);
      return { file, timeline: parsed.timeline };
    });
}

const builtins = loadBuiltins();

function planFor(timeline: TimelinePackage, profile: PlayerProfile, countdownMs: number) {
  return buildPlaybackPlan({
    timeline,
    profile,
    enabledTrackIds: timeline.tracks.map((track) => track.id),
    countdownMs,
    audio: DEFAULT_SETTINGS.audio,
    collisionWindowMs: DEFAULT_SETTINGS.collisionWindowMs,
    maxLateMs: DEFAULT_SETTINGS.maxLateMs,
    sessionOffsetMs: 0,
    speechSupported: true,
  });
}

/** The identity each plan is actually written for, so its job track is included. */
function widestProfile(timeline: TimelinePackage): PlayerProfile {
  let best: PlayerProfile = { position: 'MT', job: 'PLD' };
  let bestCount = -1;
  for (const position of PARTY_POSITIONS) {
    for (const job of JOB_CODES) {
      const profile: PlayerProfile = { position, job };
      const count = planFor(timeline, profile, 20_000).cues.length;
      if (count > bestCount) {
        bestCount = count;
        best = profile;
      }
    }
  }
  return best;
}

describe('內建時間軸在播放器實際提供的倒數選項下可以播放', () => {
  it.each(builtins.map((b) => [b.file, b] as const))(
    '%s：minimumCountdownMs 等於最早提示，且所有夠長的倒數都能開始',
    (_file, builtin) => {
      const profile = widestProfile(builtin.timeline);
      const plan = planFor(builtin.timeline, profile, 20_000);

      // 直接從資料算出的最早觸發時間，當作獨立的對照組
      let earliest = 0;
      for (const track of builtin.timeline.tracks) {
        for (const event of track.events) {
          if (event.timing.kind !== 'absolute') continue;
          for (const cue of event.cues) {
            earliest = Math.min(earliest, event.timing.atMs + (cue.offsetMs ?? 0));
          }
        }
      }
      expect(plan.minimumCountdownMs).toBe(-earliest);

      for (const preset of COUNTDOWN_PRESETS_MS) {
        if (preset < plan.minimumCountdownMs) continue; // UI 會停用這些
        const usable = planFor(builtin.timeline, profile, preset);
        expect(
          usable.errors.map((issue) => issue.code),
          `${_file} @ ${preset}ms`,
        ).toEqual([]);
        expect(usable.canStart, `${_file} @ ${preset}ms`).toBe(true);
      }
    },
  );

  it('倒數不足時仍然阻擋，而且說得出這一場需要多長', () => {
    const m5s = builtins.find((b) => b.file === 'm5s-h2-scholar.json');
    if (!m5s) throw new Error('找不到 m5s-h2-scholar.json');

    const scholar: PlayerProfile = { position: 'H2', job: 'SCH' };
    const blocked = planFor(m5s.timeline, scholar, 10_000);

    expect(blocked.canStart).toBe(false);
    expect(blocked.minimumCountdownMs).toBe(15_000);
    const issue = blocked.errors.find((error) => error.code === 'plan.cue-before-countdown');
    expect(issue?.hint).toContain('15 秒');

    // 而 15 秒（就是這份時間軸自己的預設）可以開始
    const fine = planFor(m5s.timeline, scholar, 15_000);
    expect(fine.canStart).toBe(true);
    expect(fine.cues.length).toBe(113);
  });

  it('校時是 0 的時候，不會有錯誤把問題怪到校時頭上', () => {
    const m5s = builtins.find((b) => b.file === 'm5s-h2-scholar.json');
    if (!m5s) throw new Error('找不到 m5s-h2-scholar.json');

    const blocked = planFor(m5s.timeline, { position: 'H2', job: 'SCH' }, 10_000);
    expect(blocked.errors.map((error) => error.code)).not.toContain('plan.offset-skips-cues');
    // 真正的原因只有倒數不夠
    expect(new Set(blocked.errors.map((error) => error.code))).toEqual(
      new Set(['plan.cue-before-countdown']),
    );
  });
});
