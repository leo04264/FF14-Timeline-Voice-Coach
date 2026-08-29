# FF14 Timeline Voice Coach

Pure-frontend voice reminder tool driven by pre-authored FF14 fight timelines.
Pick a timeline, pick your party position and job, choose tracks, set the
countdown, press START — the site speaks each cue at its scheduled time.

V0.1: static web app, no backend, no game integration. Deployed to GitHub Pages.

## What it does / does not do

It tells you what to do at a given time. It does **not** read your HP, buffs,
combat log or packets, does not detect boss phases, and does not know whether
you actually pressed anything. Timing comes from **manual START + timeline +
manual offset correction** only.

## Run it

```bash
npm install
npm run dev
```

```bash
npm run test
```

```bash
npm run build
```

The production build targets `https://<user>.github.io/FF14-Timeline-Voice-Coach/`.
Override the base path with `BASE_PATH=/other-path/ npm run build`.
`.github/workflows/deploy.yml` builds and publishes on push to `master`.

## Architecture

```
Timeline Data → Validation → Collision Analysis → Compiler
   → Compiled Timeline → TimelineEngine → Clock + AudioBackend
```

React only consumes this pipeline; it is never the timing source.

| Layer | Path | Notes |
| --- | --- | --- |
| Domain model | `src/timeline/types.ts` | All times are milliseconds |
| Schema | `src/timeline/schema.ts` | Zod, runs before anything else |
| Validation | `src/timeline/validator.ts` | Blocking errors never reach the engine |
| Collision | `src/timeline/collision.ts` | Editor advisory only — runtime never drops cues |
| Compiler | `src/timeline/compiler.ts` | Track filter → target filter → offsets → deterministic sort |
| Engine | `src/engine/TimelineEngine.ts` | Framework free, injectable `Clock` and `Ticker` |
| Audio | `src/audio/BrowserTtsBackend.ts` | The only file that touches `speechSynthesis` |
| Debug | `src/debug/` | Timing telemetry, statistics, CSV export |
| Storage | `src/storage/` | LocalStorage behind a repository interface |

Replacing Browser TTS with a WebAudio backend in V0.2 means implementing
`AudioBackend` — the domain model, compiler and player core stay unchanged.

## Timeline format

```jsonc
{
  "schemaVersion": 1,
  "id": "<uuid>",
  "meta": { "name": "M4S", "encounterId": "m4s", "strategy": "tw-pf", "version": "1.2.0" },
  "encounter": { "durationMs": 600000, "countdownMs": 15000 },
  "tracks": [
    {
      "id": "<uuid>",
      "type": "encounter",
      "name": "Boss Mechanics",
      "enabledByDefault": true,
      "events": [
        {
          "id": "<uuid>",
          "atMs": 48000,
          "name": "Tank Buster",
          "phase": "P1",
          "category": "tankbuster",
          "cues": [
            { "id": "<uuid>", "offsetMs": -3000, "text": "三秒後坦克死刑", "target": { "positions": ["MT"] }, "priority": "high" }
          ]
        }
      ]
    }
  ]
}
```

- Cue trigger time = `event.atMs + cue.offsetMs`; negative times run during the countdown.
- Target dimensions are OR within a dimension, AND across dimensions; a track target
  intersects with the cue target.
- Built-in read-only templates live in `public/timelines/`, listed by
  `public/timelines/index.json`. Editing one forks it.
- Selecting an encounter event in the editor exposes **其他軌道動作**. It can
  create a normal event on another track at the same encounter time, with a cue
  offset relative to the mechanic. The new event is independent: moving the
  encounter event later does not move actions that were already created.

## Verifying timing (do this before trusting it in a raid)

The real question for V0.1 is whether a browser tab still speaks on time once
FF14 has focus. Run the built-in **5-Minute Timing Test** timeline (regenerate
it with `node scripts/gen-timing-test.mjs`) in each of these situations, then
compare the Debug panel:

1. Chrome foreground
2. Chrome in a background tab
3. Chrome minimised
4. FF14 borderless in the foreground
5. FF14 fullscreen in the foreground

Judge on **Approx Audible Late P95**, plus Max and Skipped:

| P95 | Verdict |
| --- | --- |
| ≤150ms | very good |
| 150–300ms | acceptable |
| 300–500ms | watch |
| 500–1000ms | raid experience suffers |
| >1000ms | Browser TTS not usable as-is |

Many skipped cues, or hidden-tab P95 above 1000ms, is the trigger to move the
audio scheduling layer to WebAudio in V0.2.

## Shortcuts

| Key | Action |
| --- | --- |
| Space | 開始 / 暫停 / 繼續 |
| Esc | Wipe (can be disabled in Settings) |
| ← / → | Pull offset −0.5s / +0.5s |
| Ctrl/Cmd+Z, Ctrl+Shift+Z / Ctrl+Y | Editor undo / redo |

Shortcuts are ignored while a text field has focus.

## Known V0.1 limits

- Browser TTS scheduling is a prototype (`performance.now()` + `setInterval`, 50ms tick).
- No bulk editing, no drag & drop editor, no audio clips (text-to-speech only).
- LocalStorage only; audio blobs would need IndexedDB.
- Chrome desktop is the target; Edge is smoke-tested; Safari is not guaranteed.
