import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLibrary } from '../app/LibraryContext';
import { Modal } from '../components/common/Modal';
import { downloadText } from '../debug/csv';
import {
  exportRawDraft,
  exportTimeline,
  parseImportPayload,
  serializeTimeline,
} from '../storage/timelineIo';
import type { TimelineEntry } from '../storage/TimelineRepository';
import { cloneTimelineWithNewIds, createEmptyTimeline } from '../timeline/exampleTimeline';
import type { TimelinePackage } from '../timeline/types';

interface ImportConflict {
  timeline: TimelinePackage;
  existingName: string;
}

export function LibraryPage() {
  const { entries, locals, builtins, loading, saveTimeline, deleteTimeline, repository, refresh } =
    useLibrary();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [importError, setImportError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ImportConflict | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TimelineEntry | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const handleNew = async () => {
    const timeline = createEmptyTimeline();
    await saveTimeline(timeline);
    navigate(`/editor/${timeline.id}`);
  };

  const handleImportFile = async (file: File) => {
    setImportError(null);
    const text = await file.text();
    const result = parseImportPayload(text);
    if (!result.ok) {
      setImportError(result.error);
      return;
    }

    const existing = entries.find((entry) => entry.id === result.timeline.id);
    if (existing) {
      setConflict({
        timeline: result.timeline,
        existingName: existing.status === 'valid' ? existing.timeline.meta.name : existing.id,
      });
      return;
    }

    await saveTimeline(result.timeline);
    setNotice(`Imported "${result.timeline.meta.name}"`);
  };

  const handleDuplicate = async (timeline: TimelinePackage, label: string) => {
    const copy = cloneTimelineWithNewIds(timeline, { name: `${timeline.meta.name} (${label})` });
    await saveTimeline(copy);
    setNotice(`Created "${copy.meta.name}"`);
  };

  const handleExport = (entry: TimelineEntry) => {
    if (entry.status !== 'valid') return;
    try {
      exportTimeline(entry.timeline, entry.report);
    } catch {
      setNotice('Export blocked: fix the validation errors, or use Export Raw Draft.');
    }
  };

  const handleExportRawStored = async (entry: TimelineEntry) => {
    const raw = entry.status === 'invalid' ? entry.raw : await repository.getRaw(entry.id);
    downloadText(`${entry.id}-raw.json`, raw ?? '', 'application/json');
  };

  const renderRow = (entry: TimelineEntry) => {
    const isBuiltin = entry.source === 'builtin';
    const name = entry.status === 'valid' ? entry.timeline.meta.name : (entry.name ?? entry.id);
    const errors = entry.status === 'valid' ? entry.report.errors.length : 0;
    const warnings = entry.status === 'valid' ? entry.report.warnings.length : 0;

    return (
      <tr key={entry.id}>
        <td>
          <div>{name}</div>
          <div className="muted small mono">{entry.id}</div>
        </td>
        <td>
          <span className="badge">{isBuiltin ? 'built-in' : 'local'}</span>
        </td>
        <td>
          {entry.status === 'invalid' ? (
            <span className="badge error" title={entry.error}>
              invalid
            </span>
          ) : errors > 0 ? (
            <span className="badge error">{errors} errors</span>
          ) : warnings > 0 ? (
            <span className="badge warn">{warnings} warnings</span>
          ) : (
            <span className="badge ok">ok</span>
          )}
        </td>
        <td className="mono small">
          {entry.status === 'valid'
            ? `${entry.timeline.tracks.length} tracks · ${entry.timeline.tracks.reduce(
                (sum, track) => sum + track.events.length,
                0,
              )} events`
            : '--'}
        </td>
        <td>
          <div className="row">
            {entry.status === 'valid' && errors === 0 ? (
              <button type="button" onClick={() => navigate(`/player/${entry.id}`)}>
                Play
              </button>
            ) : null}
            {entry.status === 'valid' && !isBuiltin ? (
              <button type="button" onClick={() => navigate(`/editor/${entry.id}`)}>
                Edit
              </button>
            ) : null}
            {entry.status === 'valid' && isBuiltin ? (
              <button
                type="button"
                title="Built-in timelines are read only; editing creates a fork"
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
            ) : null}
            {entry.status === 'valid' ? (
              <>
                <button type="button" onClick={() => handleDuplicate(entry.timeline, 'Copy')}>
                  Duplicate
                </button>
                <button type="button" onClick={() => handleDuplicate(entry.timeline, 'Fork')}>
                  Fork
                </button>
                <button type="button" onClick={() => handleExport(entry)}>
                  Export
                </button>
                <button type="button" className="ghost" onClick={() => exportRawDraft(entry.timeline)}>
                  Export Raw Draft
                </button>
              </>
            ) : (
              <button type="button" onClick={() => void handleExportRawStored(entry)}>
                Export Raw Data
              </button>
            )}
            {!isBuiltin ? (
              <button type="button" className="danger" onClick={() => setPendingDelete(entry)}>
                Delete
              </button>
            ) : null}
          </div>
        </td>
      </tr>
    );
  };

  return (
    <section className="col">
      <div className="page-header">
        <h1>Timeline Library</h1>
        <div className="row">
          <button type="button" className="primary" onClick={() => void handleNew()}>
            New Timeline
          </button>
          <button type="button" onClick={() => fileInputRef.current?.click()}>
            Import JSON
          </button>
          <button type="button" className="ghost" onClick={() => void refresh()}>
            Refresh
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void handleImportFile(file);
            }}
          />
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

      {importError ? (
        <div className="panel">
          <p className="text-error">Import failed: {importError}</p>
        </div>
      ) : null}

      {loading ? <p className="muted">Loading…</p> : null}

      <div className="panel">
        <h2>My Timelines ({locals.length})</h2>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Source</th>
              <th>Status</th>
              <th>Contents</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {locals.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  Nothing stored yet. Create a new timeline or fork a built-in one.
                </td>
              </tr>
            ) : null}
            {locals.map(renderRow)}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h2>Built-in Templates ({builtins.length})</h2>
        <p className="muted small">Read only — editing creates a fork (spec §64).</p>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Source</th>
              <th>Status</th>
              <th>Contents</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>{builtins.map(renderRow)}</tbody>
        </table>
      </div>

      {conflict ? (
        <Modal
          title="Timeline id already exists"
          onClose={() => setConflict(null)}
          footer={
            <>
              <button type="button" onClick={() => setConflict(null)}>
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  const copy = cloneTimelineWithNewIds(conflict.timeline, {
                    name: `${conflict.timeline.meta.name} (Imported Copy)`,
                  });
                  await saveTimeline(copy);
                  setConflict(null);
                  setNotice(`Imported as copy: "${copy.meta.name}"`);
                }}
              >
                Import as Copy
              </button>
              <button
                type="button"
                className="danger"
                onClick={async () => {
                  await saveTimeline(conflict.timeline);
                  setConflict(null);
                  setNotice(`Replaced "${conflict.timeline.meta.name}"`);
                }}
              >
                Replace
              </button>
            </>
          }
        >
          <p>
            The imported timeline has the same id as <strong>{conflict.existingName}</strong>.
            Nothing is overwritten without your choice (spec §67).
          </p>
        </Modal>
      ) : null}

      {pendingDelete ? (
        <Modal
          title="Delete timeline?"
          onClose={() => setPendingDelete(null)}
          footer={
            <>
              <button type="button" onClick={() => setPendingDelete(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  if (pendingDelete.status === 'valid') {
                    downloadText(
                      `${pendingDelete.id}-backup.json`,
                      serializeTimeline(pendingDelete.timeline),
                    );
                  }
                }}
              >
                Download backup first
              </button>
              <button
                type="button"
                className="danger"
                onClick={async () => {
                  await deleteTimeline(pendingDelete.id);
                  setPendingDelete(null);
                  setNotice('Timeline deleted');
                }}
              >
                Delete
              </button>
            </>
          }
        >
          <p>
            <strong>
              {pendingDelete.status === 'valid'
                ? pendingDelete.timeline.meta.name
                : (pendingDelete.name ?? pendingDelete.id)}
            </strong>{' '}
            will be removed. V0.1 has no trash — this cannot be undone after you leave the page
            (spec §66).
          </p>
        </Modal>
      ) : null}
    </section>
  );
}
