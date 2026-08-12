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
    const timeline = createEmptyTimeline('新的時間軸');
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
    setNotice(`已匯入「${result.timeline.meta.name}」`);
  };

  const handleDuplicate = async (timeline: TimelinePackage, label: string) => {
    const copy = cloneTimelineWithNewIds(timeline, { name: `${timeline.meta.name}（${label}）` });
    await saveTimeline(copy);
    setNotice(`已建立「${copy.meta.name}」`);
  };

  const handleExport = (entry: TimelineEntry) => {
    if (entry.status !== 'valid') return;
    try {
      exportTimeline(entry.timeline, entry.report);
    } catch {
      setNotice('無法正式匯出：請先修正驗證錯誤，或改用「匯出草稿」。');
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
          <span className="badge">{isBuiltin ? '內建' : '本機'}</span>
        </td>
        <td>
          {entry.status === 'invalid' ? (
            <span className="badge error" title={entry.error}>
              無法讀取
            </span>
          ) : errors > 0 ? (
            <span className="badge error">{errors} 個錯誤</span>
          ) : warnings > 0 ? (
            <span className="badge warn">{warnings} 個警告</span>
          ) : (
            <span className="badge ok">正常</span>
          )}
        </td>
        <td className="mono small">
          {entry.status === 'valid'
            ? `${entry.timeline.tracks.length} 軌道 · ${entry.timeline.tracks.reduce(
                (sum, track) => sum + track.events.length,
                0,
              )} 事件`
            : '--'}
        </td>
        <td>
          <div className="row">
            {entry.status === 'valid' && errors === 0 ? (
              <button type="button" onClick={() => navigate(`/player/${entry.id}`)}>
                播放
              </button>
            ) : null}
            {entry.status === 'valid' && !isBuiltin ? (
              <button type="button" onClick={() => navigate(`/editor/${entry.id}`)}>
                編輯
              </button>
            ) : null}
            {entry.status === 'valid' && isBuiltin ? (
              <button
                type="button"
                title="內建時間軸是唯讀的，編輯會自動建立一份衍生版本"
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
            ) : null}
            {entry.status === 'valid' ? (
              <>
                <button type="button" onClick={() => handleDuplicate(entry.timeline, '複本')}>
                  複製
                </button>
                <button type="button" onClick={() => handleDuplicate(entry.timeline, '衍生')}>
                  衍生
                </button>
                <button type="button" onClick={() => handleExport(entry)}>
                  匯出 JSON
                </button>
                <button type="button" className="ghost" onClick={() => exportRawDraft(entry.timeline)}>
                  匯出草稿
                </button>
              </>
            ) : (
              <button type="button" onClick={() => void handleExportRawStored(entry)}>
                匯出原始資料
              </button>
            )}
            {!isBuiltin ? (
              <button type="button" className="danger" onClick={() => setPendingDelete(entry)}>
                刪除
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
        <h1>時間軸庫</h1>
        <div className="row">
          <button type="button" className="primary" onClick={() => void handleNew()}>
            新增時間軸
          </button>
          <button type="button" onClick={() => fileInputRef.current?.click()}>
            匯入 JSON
          </button>
          <button type="button" className="ghost" onClick={() => void refresh()}>
            重新整理
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
            關閉
          </button>
        </div>
      ) : null}

      {importError ? (
        <div className="panel">
          <p className="text-error">匯入失敗：{importError}</p>
        </div>
      ) : null}

      {loading ? <p className="muted">載入中…</p> : null}

      <div className="panel">
        <h2>我的時間軸（{locals.length}）</h2>
        <table>
          <thead>
            <tr>
              <th>名稱</th>
              <th>來源</th>
              <th>狀態</th>
              <th>內容</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {locals.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  還沒有任何資料。可以新增一份，或從內建範本衍生一份。
                </td>
              </tr>
            ) : null}
            {locals.map(renderRow)}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h2>內建範本（{builtins.length}）</h2>
        <p className="muted small">唯讀，編輯時會自動建立衍生版本（規格 §64）。</p>
        <table>
          <thead>
            <tr>
              <th>名稱</th>
              <th>來源</th>
              <th>狀態</th>
              <th>內容</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>{builtins.map(renderRow)}</tbody>
        </table>
      </div>

      {conflict ? (
        <Modal
          title="時間軸 ID 重複"
          onClose={() => setConflict(null)}
          footer={
            <>
              <button type="button" onClick={() => setConflict(null)}>
                取消
              </button>
              <button
                type="button"
                onClick={async () => {
                  const copy = cloneTimelineWithNewIds(conflict.timeline, {
                    name: `${conflict.timeline.meta.name}（匯入複本）`,
                  });
                  await saveTimeline(copy);
                  setConflict(null);
                  setNotice(`已匯入為複本：「${copy.meta.name}」`);
                }}
              >
                匯入成複本
              </button>
              <button
                type="button"
                className="danger"
                onClick={async () => {
                  await saveTimeline(conflict.timeline);
                  setConflict(null);
                  setNotice(`已覆蓋「${conflict.timeline.meta.name}」`);
                }}
              >
                覆蓋
              </button>
            </>
          }
        >
          <p>
            匯入的時間軸和 <strong>{conflict.existingName}</strong> 的 ID
            相同。在你選擇之前不會動到現有資料（規格 §67）。
          </p>
        </Modal>
      ) : null}

      {pendingDelete ? (
        <Modal
          title="確定要刪除嗎？"
          onClose={() => setPendingDelete(null)}
          footer={
            <>
              <button type="button" onClick={() => setPendingDelete(null)}>
                取消
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
                先下載備份
              </button>
              <button
                type="button"
                className="danger"
                onClick={async () => {
                  await deleteTimeline(pendingDelete.id);
                  setPendingDelete(null);
                  setNotice('已刪除');
                }}
              >
                刪除
              </button>
            </>
          }
        >
          <p>
            將會移除{' '}
            <strong>
              {pendingDelete.status === 'valid'
                ? pendingDelete.timeline.meta.name
                : (pendingDelete.name ?? pendingDelete.id)}
            </strong>
            。V0.1 沒有垃圾桶，離開頁面之後就救不回來了（規格 §66）。
          </p>
        </Modal>
      ) : null}
    </section>
  );
}
