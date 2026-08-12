import { useEffect, useState } from 'react';
import { useSettings } from '../app/SettingsContext';
import { BrowserTtsBackend, isSpeechSynthesisSupported, loadVoices } from '../audio/BrowserTtsBackend';
import { COLLISION_WINDOW_PRESETS_MS } from '../timeline/collision';
import { formatSecondsSigned } from '../timeline/time';

export function SettingsPage() {
  const { settings, update, reset } = useSettings();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [backend] = useState(() => new BrowserTtsBackend());

  useEffect(() => {
    let cancelled = false;
    void loadVoices().then((list) => {
      if (!cancelled) setVoices(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="col">
      <div className="page-header">
        <h1>Settings</h1>
        <button type="button" className="ghost" onClick={reset}>
          Reset to defaults
        </button>
      </div>

      <div className="panel col">
        <h2>Player</h2>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.quickStart}
            onChange={(event) => update({ quickStart: event.target.checked })}
          />
          Quick Start — skip the Ready Summary before the countdown
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.escWipe}
            onChange={(event) => update({ escWipe: event.target.checked })}
          />
          Esc triggers WIPE
        </label>
        <p className="small muted">
          Session offset is currently {formatSecondsSigned(settings.sessionOffsetMs)}. It is applied
          on top of the pull offset and survives WIPE.
        </p>
      </div>

      <div className="panel col">
        <h2>Editor</h2>
        <label className="field" style={{ maxWidth: 260 }}>
          Collision window
          <select
            value={settings.collisionWindowMs}
            onChange={(event) => update({ collisionWindowMs: Number(event.target.value) })}
          >
            {COLLISION_WINDOW_PRESETS_MS.map((preset) => (
              <option key={preset} value={preset}>
                {preset} ms
              </option>
            ))}
            {COLLISION_WINDOW_PRESETS_MS.includes(
              settings.collisionWindowMs as (typeof COLLISION_WINDOW_PRESETS_MS)[number],
            ) ? null : (
              <option value={settings.collisionWindowMs}>{settings.collisionWindowMs} ms</option>
            )}
          </select>
        </label>
        <label className="field" style={{ maxWidth: 260 }}>
          Custom collision window (ms)
          <input
            type="number"
            min={0}
            step={100}
            value={settings.collisionWindowMs}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isFinite(value) && value >= 0) update({ collisionWindowMs: value });
            }}
          />
        </label>
      </div>

      <div className="panel col">
        <h2>Runtime</h2>
        <label className="field" style={{ maxWidth: 260 }}>
          Scheduler tick interval (ms)
          <input
            type="number"
            min={10}
            max={250}
            step={10}
            value={settings.tickIntervalMs}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isFinite(value) && value >= 10) update({ tickIntervalMs: value });
            }}
          />
        </label>
        <label className="field" style={{ maxWidth: 260 }}>
          Skip cues later than (ms)
          <input
            type="number"
            min={0}
            step={250}
            value={settings.maxLateMs}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isFinite(value) && value >= 0) update({ maxLateMs: value });
            }}
          />
        </label>
        <p className="small muted">
          V0.1 uses performance.now() + setInterval. Treat it as a prototype scheduler — verify with
          the 5-minute timing test before trusting it in a raid (spec §84).
        </p>
      </div>

      <div className="panel col">
        <h2>Voice</h2>
        {isSpeechSynthesisSupported() ? null : (
          <p className="text-error">
            This browser has no Web Speech API. Voice playback will not work.
          </p>
        )}
        <div className="row">
          <label className="field">
            Language
            <input
              value={settings.audio.lang}
              onChange={(event) => update({ audio: { ...settings.audio, lang: event.target.value } })}
            />
          </label>
          <label className="field" style={{ minWidth: 260 }}>
            Voice
            <select
              value={settings.audio.voiceUri ?? ''}
              onChange={(event) =>
                update({
                  audio: { ...settings.audio, voiceUri: event.target.value || undefined },
                })
              }
            >
              <option value="">(browser default)</option>
              {voices.map((voice) => (
                <option key={voice.voiceURI} value={voice.voiceURI}>
                  {voice.name} — {voice.lang}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="row">
          <label className="field">
            Rate ({settings.audio.rate.toFixed(2)})
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.05}
              value={settings.audio.rate}
              onChange={(event) =>
                update({ audio: { ...settings.audio, rate: Number(event.target.value) } })
              }
            />
          </label>
          <label className="field">
            Pitch ({settings.audio.pitch.toFixed(2)})
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={settings.audio.pitch}
              onChange={(event) =>
                update({ audio: { ...settings.audio, pitch: Number(event.target.value) } })
              }
            />
          </label>
          <label className="field">
            Volume ({settings.audio.volume.toFixed(2)})
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.audio.volume}
              onChange={(event) =>
                update({ audio: { ...settings.audio, volume: Number(event.target.value) } })
              }
            />
          </label>
        </div>
        <div className="row">
          <button
            type="button"
            onClick={async () => {
              await backend.prepare([]);
              backend.speakPreview('三秒後坦克死刑', {
                lang: settings.audio.lang,
                rate: settings.audio.rate,
                pitch: settings.audio.pitch,
                volume: settings.audio.volume,
                voiceUri: settings.audio.voiceUri,
              });
            }}
          >
            Test voice
          </button>
        </div>
      </div>
    </section>
  );
}
