import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLibrary } from '../app/LibraryContext';
import { useSettings } from '../app/SettingsContext';
import { EventDetail } from '../components/editor/EventDetail';
import { EventTable } from '../components/editor/EventTable';
import { TrackList } from '../components/editor/TrackList';
import { ValidationSummary } from '../components/editor/ValidationSummary';
import { TimeInput } from '../components/editor/TimeInput';
import { SAVE_STATUS_TEXT } from '../i18n/labels';
import { useEditorState } from '../hooks/useEditorState';
import { exportRawDraft, exportTimeline } from '../storage/timelineIo';
import { analyzeCollisions } from '../timeline/collision';
import { cloneTimelineWithNewIds } from '../timeline/exampleTimeline';
import { validateTimeline, type ValidationIssue } from '../timeline/validator';
import type { TimelinePackage } from '../timeline/types';

type EditorLocation =
  | { kind: 'track'; id: string }
  | { kind: 'event'; id: string }
  | { kind: 'cue'; id: string };

export function EditorPage() {
  const { timelineId } = useParams();
  const navigate = useNavigate();
  const { entries, repository, refresh, saveTimeline, loading } = useLibrary();
  const { settings } = useSettings();

  const editor = useEditorState(repository);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [highlightCueId, setHighlightCueId] = useState<string | null>(null);
  const [pendingLocation, setPendingLocation] = useState<EditorLocation | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const entry = useMemo(
    () => entries.find((candidate) => candidate.id === timelineId),
    [entries, timelineId],
  );

  // Load the document once per timeline id.
  useEffect(() => {
    if (!entry || entry.status !== 'valid') {
      editor.resetTimeline(null);
      return;
    }
    editor.resetTimeline(entry.timeline);
    setSelectedTrackId(entry.timeline.tracks[0]?.id ?? null);
    setSelectedEventId(entry.timeline.tracks[0]?.events[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.id, entry?.status]);

  // Ctrl/Cmd+Z / Ctrl+Shift+Z / Ctrl+Y
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        editor.undo();
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault();
        editor.redo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editor]);

  const timeline = editor.timeline;

  const report = useMemo(
    () => (timeline ? validateTimeline(timeline) : null),
    [timeline],
  );
  const collisions = useMemo(
    () =>
      timeline
        ? analyzeCollisions(timeline, settings.collisionWindowMs)
        : { windowMs: settings.collisionWindowMs, pairs: [], byCueId: new Map() },
    [timeline, settings.collisionWindowMs],
  );

  useEffect(() => {
    if (!pendingLocation) return;
    const handle = window.requestAnimationFrame(() => {
      const attribute = `data-${pendingLocation.kind}-id`;
      const target = [...document.querySelectorAll<HTMLElement>(`[${attribute}]`)].find(
        (element) => element.getAttribute(attribute) === pendingLocation.id,
      );
      target?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      setPendingLocation(null);
    });
    return () => window.cancelAnimationFrame(handle);
  }, [pendingLocation]);

  if (loading) return <p className="muted">載入中…</p>;

  if (!timelineId) {
    const editable = entries.filter(
      (candidate) => candidate.status === 'valid' && candidate.source === 'local',
    );
    return (
      <section className="panel col">
        <h1>編輯器</h1>
        <p className="muted">選一份要編輯的時間軸，或到時間軸庫新增一份。</p>
        {editable.map((candidate) => (
          <div className="row" key={candidate.id}>
            <button type="button" onClick={() => navigate(`/editor/${candidate.id}`)}>
              編輯
            </button>
            <span>{candidate.status === 'valid' ? candidate.timeline.meta.name : candidate.id}</span>
          </div>
        ))}
        <button type="button" className="primary" onClick={() => navigate('/library')}>
          前往時間軸庫
        </button>
      </section>
    );
  }

  if (!entry) {
    return (
      <section className="panel">
        <h1>找不到這份時間軸</h1>
        <button type="button" onClick={() => navigate('/library')}>
          回時間軸庫
        </button>
      </section>
    );
  }

  if (entry.status === 'invalid') {
    return (
      <section className="panel col">
        <h1>無法開啟這份時間軸</h1>
        <p className="text-error">{entry.error}</p>
        <p className="small muted">
          儲存的資料沒有通過格式驗證，編輯器無法安全載入。請從時間軸庫匯出原始資料，手動修好之後再匯入（規格
          §81）。
        </p>
        <button type="button" onClick={() => navigate('/library')}>
          回時間軸庫
        </button>
      </section>
    );
  }

  if (entry.source === 'builtin') {
    return (
      <section className="panel col">
        <h1>{entry.timeline.meta.name}</h1>
        <p>內建時間軸是唯讀的。要修改請先建立一份衍生版本（規格 §64）。</p>
        <button
          type="button"
          className="primary"
          onClick={async () => {
            const fork = cloneTimelineWithNewIds(entry.timeline, {
              name: `${entry.timeline.meta.name}（衍生）`,
            });
            await saveTimeline(fork);
            navigate(`/editor/${fork.id}`);
          }}
        >
          衍生後編輯
        </button>
      </section>
    );
  }

  if (!timeline || !report) return <p className="muted">時間軸載入中…</p>;

  const selectedTrack =
    timeline.tracks.find((track) => track.id === selectedTrackId) ?? timeline.tracks[0] ?? null;
  const selectedEvent =
    selectedTrack?.events.find((event) => event.id === selectedEventId) ?? null;

  const change = (next: TimelinePackage) => editor.setTimeline(next);

  const patchMeta = (patch: Partial<TimelinePackage['meta']>) =>
    change({ ...timeline, meta: { ...timeline.meta, ...patch } });

  const focusIssue = (issue: ValidationIssue) => {
    if (issue.trackId) setSelectedTrackId(issue.trackId);
    if (issue.eventId) setSelectedEventId(issue.eventId);
    setHighlightCueId(issue.cueId ?? null);
    if (issue.cueId) setPendingLocation({ kind: 'cue', id: issue.cueId });
    else if (issue.eventId) setPendingLocation({ kind: 'event', id: issue.eventId });
    else if (issue.trackId) setPendingLocation({ kind: 'track', id: issue.trackId });
  };

  return (
    <section className="col">
      <div className="page-header">
        <div>
          <h1>{timeline.meta.name}</h1>
          <p className="muted small mono">{timeline.id}</p>
        </div>
        <div className="row page-actions">
          <span className="badge">{SAVE_STATUS_TEXT[editor.saveStatus]}</span>
          {editor.saveError ? <span className="text-error small">{editor.saveError}</span> : null}
          <button type="button" disabled={!editor.canUndo} onClick={editor.undo}>
            復原
          </button>
          <button type="button" disabled={!editor.canRedo} onClick={editor.redo}>
            重做
          </button>
          <button
            type="button"
            onClick={async () => {
              await editor.saveNow();
              await refresh();
              setNotice('已儲存');
            }}
          >
            立即儲存
          </button>
          <button
            type="button"
            disabled={report.hasBlockingError}
            title={report.hasBlockingError ? '還有驗證錯誤，無法正式匯出（規格 §69）' : undefined}
            onClick={() => exportTimeline(timeline, report)}
          >
            匯出 JSON
          </button>
          <button type="button" className="ghost" onClick={() => exportRawDraft(timeline)}>
            匯出草稿
          </button>
          <button
            type="button"
            disabled={report.hasBlockingError}
            onClick={async () => {
              await editor.saveNow();
              await refresh();
              navigate(`/player/${timeline.id}`);
            }}
          >
            播放
          </button>
        </div>
      </div>

      {notice ? (
        <div className="panel row">
          <span>{notice}</span>
          <span className="spacer" />
          <button type="button" className="ghost" onClick={() => setNotice(null)}>
            關閉
          </button>
        </div>
      ) : null}

      <ValidationSummary
        timeline={timeline}
        report={report}
        collisions={collisions}
        onSelectIssue={focusIssue}
        onSelectCue={(trackId, eventId, cueId) => {
          setSelectedTrackId(trackId);
          setSelectedEventId(eventId);
          setHighlightCueId(cueId);
          setPendingLocation({ kind: 'cue', id: cueId });
        }}
      />

      <details className="panel">
        <summary>時間軸設定</summary>
        <div className="col" style={{ marginTop: '0.6rem' }}>
          <div className="row responsive-fields">
            <label className="field">
              名稱
              <input
                value={timeline.meta.name}
                onChange={(event) => patchMeta({ name: event.target.value })}
              />
            </label>
            <label className="field">
              副本代號
              <input
                value={timeline.meta.encounterId}
                onChange={(event) => patchMeta({ encounterId: event.target.value })}
              />
            </label>
            <label className="field">
              打法
              <input
                value={timeline.meta.strategy ?? ''}
                onChange={(event) => patchMeta({ strategy: event.target.value || undefined })}
              />
            </label>
            <label className="field">
              版本
              <input
                value={timeline.meta.version ?? ''}
                placeholder="1.0.0"
                onChange={(event) => patchMeta({ version: event.target.value || undefined })}
              />
            </label>
            <label className="field">
              作者
              <input
                value={timeline.meta.author ?? ''}
                onChange={(event) => patchMeta({ author: event.target.value || undefined })}
              />
            </label>
          </div>
          <label className="field">
            說明
            <textarea
              rows={2}
              value={timeline.meta.description ?? ''}
              onChange={(event) => patchMeta({ description: event.target.value || undefined })}
            />
          </label>
          <div className="row responsive-fields" style={{ alignItems: 'flex-start' }}>
            <TimeInput
              label="戰鬥全長"
              valueMs={timeline.encounter.durationMs}
              allowNegative={false}
              onChange={(ms) =>
                change({ ...timeline, encounter: { ...timeline.encounter, durationMs: ms } })
              }
            />
            <TimeInput
              label="預設倒數"
              valueMs={timeline.encounter.countdownMs}
              allowNegative={false}
              onChange={(ms) =>
                change({ ...timeline, encounter: { ...timeline.encounter, countdownMs: ms } })
              }
            />
          </div>
        </div>
      </details>

      <div className="editor-layout">
        <div className="editor-column">
          <TrackList
            timeline={timeline}
            selectedTrackId={selectedTrack?.id ?? null}
            onSelectTrack={(trackId) => {
              setSelectedTrackId(trackId);
              const track = timeline.tracks.find((candidate) => candidate.id === trackId);
              setSelectedEventId(track?.events[0]?.id ?? null);
            }}
            onChange={change}
          />
        </div>

        <div className="editor-column">
          {selectedTrack ? (
            <EventTable
              timeline={timeline}
              track={selectedTrack}
              selectedEventId={selectedEvent?.id ?? null}
              collisions={collisions}
              onSelectEvent={(eventId) => {
                setSelectedEventId(eventId);
                setHighlightCueId(null);
              }}
              onChange={change}
            />
          ) : (
            <p className="muted">先新增一個軌道才能開始。</p>
          )}
        </div>

        <div className="editor-column">
          {selectedTrack ? (
            <EventDetail
              timeline={timeline}
              trackId={selectedTrack.id}
              event={selectedEvent}
              collisions={collisions}
              highlightCueId={highlightCueId}
              onChange={change}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}
