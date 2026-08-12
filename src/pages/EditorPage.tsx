import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLibrary } from '../app/LibraryContext';
import { useSettings } from '../app/SettingsContext';
import { EventDetail } from '../components/editor/EventDetail';
import { EventTable } from '../components/editor/EventTable';
import { TrackList } from '../components/editor/TrackList';
import { ValidationSummary } from '../components/editor/ValidationSummary';
import { TimeInput } from '../components/editor/TimeInput';
import { SAVE_STATUS_LABEL, useEditorState } from '../hooks/useEditorState';
import { exportRawDraft, exportTimeline } from '../storage/timelineIo';
import { analyzeCollisions } from '../timeline/collision';
import { cloneTimelineWithNewIds } from '../timeline/exampleTimeline';
import { validateTimeline, type ValidationIssue } from '../timeline/validator';
import type { TimelinePackage } from '../timeline/types';

export function EditorPage() {
  const { timelineId } = useParams();
  const navigate = useNavigate();
  const { entries, repository, refresh, saveTimeline, loading } = useLibrary();
  const { settings } = useSettings();

  const editor = useEditorState(repository);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [highlightCueId, setHighlightCueId] = useState<string | null>(null);
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

  const cueIndex = useMemo(() => {
    const index = new Map<string, { trackId: string; eventId: string }>();
    if (!timeline) return index;
    for (const track of timeline.tracks) {
      for (const event of track.events) {
        for (const cue of event.cues) {
          index.set(cue.id, { trackId: track.id, eventId: event.id });
        }
      }
    }
    return index;
  }, [timeline]);

  if (loading) return <p className="muted">Loading…</p>;

  if (!timelineId) {
    const editable = entries.filter(
      (candidate) => candidate.status === 'valid' && candidate.source === 'local',
    );
    return (
      <section className="panel col">
        <h1>Editor</h1>
        <p className="muted">Pick a timeline to edit, or create one in the Library.</p>
        {editable.map((candidate) => (
          <div className="row" key={candidate.id}>
            <button type="button" onClick={() => navigate(`/editor/${candidate.id}`)}>
              Edit
            </button>
            <span>{candidate.status === 'valid' ? candidate.timeline.meta.name : candidate.id}</span>
          </div>
        ))}
        <button type="button" className="primary" onClick={() => navigate('/library')}>
          Go to Library
        </button>
      </section>
    );
  }

  if (!entry) {
    return (
      <section className="panel">
        <h1>Timeline not found</h1>
        <button type="button" onClick={() => navigate('/library')}>
          Back to Library
        </button>
      </section>
    );
  }

  if (entry.status === 'invalid') {
    return (
      <section className="panel col">
        <h1>Timeline cannot be opened</h1>
        <p className="text-error">{entry.error}</p>
        <p className="small muted">
          The stored data failed schema validation, so the editor cannot load it safely. Export the
          raw data from the Library and repair it by hand (spec §81).
        </p>
        <button type="button" onClick={() => navigate('/library')}>
          Back to Library
        </button>
      </section>
    );
  }

  if (entry.source === 'builtin') {
    return (
      <section className="panel col">
        <h1>{entry.timeline.meta.name}</h1>
        <p>Built-in timelines are read only. Fork it to make changes (spec §64).</p>
        <button
          type="button"
          className="primary"
          onClick={async () => {
            const fork = cloneTimelineWithNewIds(entry.timeline, {
              name: `${entry.timeline.meta.name} (Fork)`,
            });
            await saveTimeline(fork);
            navigate(`/editor/${fork.id}`);
          }}
        >
          Fork &amp; Edit
        </button>
      </section>
    );
  }

  if (!timeline || !report) return <p className="muted">Loading timeline…</p>;

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
  };

  return (
    <section className="col">
      <div className="page-header">
        <div>
          <h1>{timeline.meta.name}</h1>
          <p className="muted small mono">{timeline.id}</p>
        </div>
        <div className="row">
          <span className="badge">{SAVE_STATUS_LABEL[editor.saveStatus] || 'Idle'}</span>
          {editor.saveError ? <span className="text-error small">{editor.saveError}</span> : null}
          <button type="button" disabled={!editor.canUndo} onClick={editor.undo}>
            Undo
          </button>
          <button type="button" disabled={!editor.canRedo} onClick={editor.redo}>
            Redo
          </button>
          <button
            type="button"
            onClick={async () => {
              await editor.saveNow();
              await refresh();
              setNotice('Saved');
            }}
          >
            Save now
          </button>
          <button
            type="button"
            disabled={report.hasBlockingError}
            title={
              report.hasBlockingError
                ? 'Blocked while validation errors exist (spec §69)'
                : undefined
            }
            onClick={() => exportTimeline(timeline, report)}
          >
            Export JSON
          </button>
          <button type="button" className="ghost" onClick={() => exportRawDraft(timeline)}>
            Export Raw Draft
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
            Play
          </button>
        </div>
      </div>

      {notice ? (
        <div className="panel row">
          <span>{notice}</span>
          <span className="spacer" />
          <button type="button" className="ghost" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      <ValidationSummary
        report={report}
        collisions={collisions}
        cueIndex={cueIndex}
        onSelectIssue={focusIssue}
        onSelectCue={(trackId, eventId, cueId) => {
          setSelectedTrackId(trackId);
          setSelectedEventId(eventId);
          setHighlightCueId(cueId);
        }}
      />

      <details className="panel">
        <summary>Timeline settings</summary>
        <div className="col" style={{ marginTop: '0.6rem' }}>
          <div className="row">
            <label className="field">
              Name
              <input
                value={timeline.meta.name}
                onChange={(event) => patchMeta({ name: event.target.value })}
              />
            </label>
            <label className="field">
              Encounter id
              <input
                value={timeline.meta.encounterId}
                onChange={(event) => patchMeta({ encounterId: event.target.value })}
              />
            </label>
            <label className="field">
              Strategy
              <input
                value={timeline.meta.strategy ?? ''}
                onChange={(event) => patchMeta({ strategy: event.target.value || undefined })}
              />
            </label>
            <label className="field">
              Version
              <input
                value={timeline.meta.version ?? ''}
                placeholder="1.0.0"
                onChange={(event) => patchMeta({ version: event.target.value || undefined })}
              />
            </label>
            <label className="field">
              Author
              <input
                value={timeline.meta.author ?? ''}
                onChange={(event) => patchMeta({ author: event.target.value || undefined })}
              />
            </label>
          </div>
          <label className="field">
            Description
            <textarea
              rows={2}
              value={timeline.meta.description ?? ''}
              onChange={(event) => patchMeta({ description: event.target.value || undefined })}
            />
          </label>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <TimeInput
              label="Encounter duration"
              valueMs={timeline.encounter.durationMs}
              allowNegative={false}
              onChange={(ms) =>
                change({ ...timeline, encounter: { ...timeline.encounter, durationMs: ms } })
              }
            />
            <TimeInput
              label="Default countdown"
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
            <p className="muted">Add a track to get started.</p>
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
