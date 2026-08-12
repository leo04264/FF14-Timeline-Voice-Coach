// Generates public/timelines/timing-test.json — the 5-minute timing test
// timeline required before trusting Browser TTS (spec §86).
//
//   node scripts/gen-timing-test.mjs
//
// ~25 cues, one every 12 seconds, so Debug statistics get a usable sample.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(here, '../public/timelines/timing-test.json');

const COUNTDOWN_MS = 15_000;
const DURATION_MS = 300_000;
const INTERVAL_MS = 12_000;
const COUNT = 25;

const events = [];

events.push({
  id: 'timing-test-event-countdown',
  atMs: 0,
  name: 'Pull',
  phase: 'Countdown',
  category: 'mechanic',
  cues: [
    {
      id: 'timing-test-cue-countdown',
      offsetMs: -3000,
      text: '三秒後開始',
      priority: 'high',
    },
  ],
});

for (let index = 0; index < COUNT; index += 1) {
  const atMs = (index + 1) * INTERVAL_MS;
  const seconds = Math.round(atMs / 1000);
  events.push({
    id: `timing-test-event-${index + 1}`,
    atMs,
    name: `Mark ${index + 1}`,
    phase: atMs < 150_000 ? 'P1' : 'P2',
    category: 'mechanic',
    cues: [
      {
        id: `timing-test-cue-${index + 1}`,
        offsetMs: 0,
        text: `第 ${index + 1} 次 ${seconds} 秒`,
        priority: 'normal',
      },
    ],
  });
}

const timeline = {
  schemaVersion: 1,
  id: 'builtin-timing-test',
  meta: {
    name: '5-Minute Timing Test',
    encounterId: 'timing-test',
    strategy: 'timing',
    author: 'FF14 Timeline Voice Coach',
    description:
      'Fires one cue every 12 seconds for 5 minutes. Run it in the foreground, in a background tab and behind FF14, then compare Debug statistics.',
    version: '1.0.0',
  },
  encounter: {
    durationMs: DURATION_MS,
    countdownMs: COUNTDOWN_MS,
  },
  tracks: [
    {
      id: 'timing-test-track',
      type: 'encounter',
      name: 'Timing Marks',
      enabledByDefault: true,
      events,
    },
  ],
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(timeline, null, 2)}\n`, 'utf8');
console.log(`Wrote ${outputPath} (${events.length} events)`);
