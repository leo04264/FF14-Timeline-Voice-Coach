import { useEffect, useState } from 'react';
import { useSettings } from '../app/SettingsContext';
import { BrowserTtsBackend, isSpeechSynthesisSupported, loadVoices } from '../audio/BrowserTtsBackend';
import { COLLISION_WINDOW_PRESETS_MS } from '../timeline/collision';
import { formatSecondsSigned } from '../timeline/time';

export function SettingsPage() {
  const { settings, update, reset } = useSettings();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [backend] = useState(() => new BrowserTtsBackend());
  const [voiceTestStatus, setVoiceTestStatus] = useState<string | null>(null);

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
        <h1>設定</h1>
        <button type="button" className="ghost" onClick={reset}>
          回復預設值
        </button>
      </div>

      <div className="panel col">
        <h2>播放器</h2>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.quickStart}
            onChange={(event) => update({ quickStart: event.target.checked })}
          />
          快速開始 — 按下開始後跳過確認畫面，直接進入倒數
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.escWipe}
            onChange={(event) => update({ escWipe: event.target.checked })}
          />
          Esc 觸發重置
        </label>
        <p className="small muted">
          目前的全域偏移是 {formatSecondsSigned(settings.sessionOffsetMs)}
          。它會疊加在本場偏移之上，而且不會被重置清除。
        </p>
      </div>

      <div className="panel col">
        <h2>編輯器</h2>
        <label className="field settings-number-field">
          衝突判定區間
          <select
            value={settings.collisionWindowMs}
            onChange={(event) => update({ collisionWindowMs: Number(event.target.value) })}
          >
            {COLLISION_WINDOW_PRESETS_MS.map((preset) => (
              <option key={preset} value={preset}>
                {preset} 毫秒
              </option>
            ))}
            {COLLISION_WINDOW_PRESETS_MS.includes(
              settings.collisionWindowMs as (typeof COLLISION_WINDOW_PRESETS_MS)[number],
            ) ? null : (
              <option value={settings.collisionWindowMs}>{settings.collisionWindowMs} 毫秒</option>
            )}
          </select>
        </label>
        <label className="field settings-number-field">
          自訂衝突判定區間（毫秒）
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
        <h2>執行參數</h2>
        <label className="field settings-number-field">
          排程器 tick 間隔（毫秒）
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
        <label className="field settings-number-field">
          遲到超過多久就略過（毫秒）
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
          V0.1 使用 performance.now() 搭配 setInterval，只能算是原型排程器。正式在高難度副本使用之前，請先跑過
          5 分鐘延遲測試（規格 §84）。
        </p>
      </div>

      <div className="panel col">
        <h2>語音</h2>
        {isSpeechSynthesisSupported() ? null : (
          <p className="text-error">這個瀏覽器沒有 Web Speech API，無法播放語音。</p>
        )}
        <div className="row responsive-fields">
          <label className="field">
            語言
            <input
              value={settings.audio.lang}
              onChange={(event) => update({ audio: { ...settings.audio, lang: event.target.value } })}
            />
          </label>
          <label className="field settings-voice-field">
            語音
            <select
              value={settings.audio.voiceUri ?? ''}
              onChange={(event) =>
                update({
                  audio: { ...settings.audio, voiceUri: event.target.value || undefined },
                })
              }
            >
              <option value="">（瀏覽器預設）</option>
              {voices.map((voice) => (
                <option key={voice.voiceURI} value={voice.voiceURI}>
                  {voice.name} — {voice.lang}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="row responsive-fields">
          <label className="field">
            語速（{settings.audio.rate.toFixed(2)}）
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
            音調（{settings.audio.pitch.toFixed(2)}）
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
            音量（{settings.audio.volume.toFixed(2)}）
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
            disabled={voiceTestStatus === '正在準備語音…'}
            onClick={async () => {
              setVoiceTestStatus('正在準備語音…');
              try {
                await backend.prepare([]);
                const queued = backend.speakPreview('三秒後坦克死刑', {
                  lang: settings.audio.lang,
                  rate: settings.audio.rate,
                  pitch: settings.audio.pitch,
                  volume: settings.audio.volume,
                  voiceUri: settings.audio.voiceUri,
                });
                setVoiceTestStatus(
                  queued
                    ? '已送出測試語音；若沒有聽到，請改選其他語音或確認系統音量。'
                    : '這個瀏覽器不支援 Web Speech API，無法播放語音。',
                );
              } catch (error) {
                setVoiceTestStatus(
                  `測試語音失敗：${error instanceof Error ? error.message : '未知錯誤'}`,
                );
              }
            }}
          >
            播放測試語音
          </button>
          {voiceTestStatus ? <span className="small" role="status">{voiceTestStatus}</span> : null}
        </div>
        <p className="small muted">用上方目前設定念一句測試文字，不會開始播放器。</p>
      </div>
    </section>
  );
}
