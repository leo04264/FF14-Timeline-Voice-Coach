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
| Timing resolver | `src/timeline/resolveEventTiming.ts` | The single place event times and `mechanic` references are resolved |
| Compiler | `src/timeline/compiler.ts` | Track filter → target filter → offsets → deterministic sort |
| Playback plan | `src/timeline/playbackPlan.ts` | One shared preflight: applicability, counts, exclusivity, real collisions |
| Selection groups | `src/timeline/selectionGroups.ts` | Mutually exclusive alternatives, driven only by author metadata |
| Personal reminders | `src/timeline/personalReminders.ts` | The player's own quick reminders, one track per identity |
| Engine | `src/engine/TimelineEngine.ts` | Framework free, injectable `Clock` and `Ticker` |
| Audio | `src/audio/BrowserTtsBackend.ts` | The only file that touches `speechSynthesis` |
| Audio ownership | `src/audio/AudioOwnership.ts` | One owner at a time: playback outranks every editor preview |
| Preview | `src/preview/PreviewController.ts` | Segment / single-cue audition on its own clock and ticker |
| Debug | `src/debug/` | Timing telemetry, statistics, CSV export |
| Storage | `src/storage/` | LocalStorage behind a repository interface |

Replacing Browser TTS with a WebAudio backend in V0.2 means implementing
`AudioBackend` — the domain model, compiler and player core stay unchanged.

## Timeline format

```jsonc
{
  "schemaVersion": 2,
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
          "timing": { "kind": "absolute", "atMs": 48000 },
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

An event's `timing` is either an absolute time or a **live reference** to an
encounter mechanic:

```jsonc
{
  "id": "<uuid>",
  "timing": { "kind": "mechanic", "sourceTrackId": "<boss track>", "sourceEventId": "<mechanic>" },
  "name": "下野戰，準備集合",
  "category": "custom",
  "cues": [{ "id": "<uuid>", "offsetMs": -3000, "text": "下野戰，準備集合" }]
}
```

- Cue trigger time = `resolved event time + cue.offsetMs`; negative times run
  during the countdown. A `mechanic` event resolves to the referenced absolute
  time on every read, so moving the boss mechanic moves every reminder hanging
  off it while each `offsetMs` stays put. There is deliberately no second,
  independently editable `atMs`.
- References are same-document, encounter-track, absolute-source only. No
  reference chains. Self-reference, missing/wrong-kind sources and non-finite
  times are blocking errors.
- Whether the source cue is enabled or its track is selected does **not** affect
  the anchor — muting the boss callouts never moves or drops your own reminders.
- `selectionGroups` (optional) declares mutually exclusive alternatives; a track
  opts in with `selection: { groupId, optionId }`. Exclusivity is *only* ever
  driven by this metadata — never guessed from names or track counts. Tracks
  without `selection` stay freely multi-selectable, so one job's healing plan,
  damage rotation and personal reminders can all run together.
- `purpose: "personal-reminders"` marks the system-managed track that holds your
  own quick reminders for one exact position/job. At most one per identity.
- Target dimensions are OR within a dimension, AND across dimensions; a track target
  intersects with the cue target.
- **`schemaVersion: 1` files are still accepted**: the loader migrates them to V2
  in memory (`atMs` → `{ kind: "absolute", atMs }`, `offsetMs` untouched, no
  rounding, and old standalone events are never guessed into references). The
  shipped templates in `public/timelines/` are still V1 on disk.
- Built-in read-only templates live in `public/timelines/`, listed by
  `public/timelines/index.json`. You can add your own reminders to one directly —
  the first save forks it and re-points the reminder at the fork's mechanic.
- The advanced editor's **其他軌道動作** panel now asks which you want: a live
  link to the source mechanic, or a fixed-time snapshot that will not follow it.

## One identity, one plan (P0)

A formal pull has exactly one `PlayerProfile` — one position and one job. A
timeline can still carry content for many jobs, and a shared cue can still name
several jobs; the compiler just filters to who you are.

Everything the player screen shows comes from one `buildPlaybackPlan` call:
which tracks apply, how many cues each will really speak, which mutually
exclusive option is in use, and which cues in **this run** land too close
together. `plan.totalCueCount` always equals `compiled.cues.length`.

Every way of starting a pull — the big button, Space while idle, Quick Start —
goes through the same `requestStart` flow, and `engine.load() + engine.start()`
exists in exactly one place:

- blocking errors → nothing starts
- warnings that need acknowledging → an explicit "了解風險，仍開始", which
  **Quick Start does not skip**
- otherwise → the normal pre-countdown summary, or straight to the countdown

A warning acknowledgement belongs to one request only. Changing the timeline,
identity, tracks, option, countdown, audio, offset or collision window
invalidates it. There is no persistent "skip all warnings" switch, and the app
never deletes, merges, retimes or pre-empts a cue on your behalf.

## My reminders (P1)

The editor has a flat **機制＋我的提醒** list next to the original track/event
editor. Each mechanic row has **＋我的提醒**: type what to say, pick 機制前 /
當下 / 機制後 and a number of seconds, and the actual trigger time updates live.
Target, storage location, category and priority are filled in by the system, and
the reminder is stored as a live reference to that mechanic.

Deleting a mechanic that reminders point at always shows every affected
reminder — including ones belonging to other jobs you cannot see — and offers
cancel (the default), delete-together, or convert-to-fixed-time (which keeps the
real trigger instant). Every delete entry point, including the older advanced
editor, goes through this.

Single-cue audition and ±5s segment preview run on their own clock, in editing
timeline coordinates, and never touch the real pull, its offsets or the debug
log. Because both sides share one `speechSynthesis`, an app-level owner
arbitrates: a live pull outranks every editor preview, and an idle
`engine.load()` can no longer cancel a preview behind its back.

See [`docs/p0-p1-player-reminders.md`](docs/p0-p1-player-reminders.md) for the
full design, the migration rules and the known limits.

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

Shortcuts are ignored while a text field has focus, while a modal owns the
screen (Space must never confirm a risk dialog), and when the focused element is
one the browser already activates on Space/Enter — a focused button gets its
native click, not a second global handler.

## Known V0.1 limits

- Browser TTS scheduling is a prototype (`performance.now()` + `setInterval`, 50ms tick).
- No bulk editing, no drag & drop editor, no audio clips (text-to-speech only).
- LocalStorage only; audio blobs would need IndexedDB.
- Chrome desktop is the target; Edge is smoke-tested; Safari is not guaranteed.
- Collision analysis estimates spoken length from character count and a fixed
  window. It cannot tell you that real speech will overlap, and **neither format
  validation nor collision analysis says anything about whether a healing plan
  actually works in the fight.**
- `mechanic` references are same-document, encounter-track, absolute-source only;
  no reference chains.
- No V1 down-version export.
- Audio ownership is arbitrated within one app instance only — not across tabs.
