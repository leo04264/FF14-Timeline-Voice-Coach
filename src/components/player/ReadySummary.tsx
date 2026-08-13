import { Modal } from '../common/Modal';
import { JOB_NAME_LABEL } from '../../i18n/labels';
import { isConventionalAssignment } from '../../timeline/target';
import { formatSecondsSigned } from '../../timeline/time';
import type { PlayerProfile, TimelineTrack } from '../../timeline/types';

interface ReadySummaryProps {
  timelineName: string;
  profile: PlayerProfile;
  tracks: TimelineTrack[];
  enabledTrackIds: string[];
  countdownMs: number;
  effectiveOffsetMs: number;
  cueCount: number;
  onConfirm(): void;
  onCancel(): void;
}

/** Confirmation before the countdown (spec §37); skipped in Quick Start mode. */
export function ReadySummary({
  timelineName,
  profile,
  tracks,
  enabledTrackIds,
  countdownMs,
  effectiveOffsetMs,
  cueCount,
  onConfirm,
  onCancel,
}: ReadySummaryProps) {
  const enabled = tracks.filter((track) => enabledTrackIds.includes(track.id));
  const conventional = isConventionalAssignment(profile.position, profile.job);

  return (
    <Modal
      title="準備好了嗎？"
      onClose={onCancel}
      footer={
        <>
          <button type="button" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="primary" autoFocus onClick={onConfirm}>
            開始
          </button>
        </>
      }
    >
      <dl className="col ready-summary" style={{ margin: 0 }}>
        <div className="row ready-summary-row">
          <strong>時間軸</strong>
          <span>{timelineName}</span>
        </div>
        <div className="row ready-summary-row">
          <strong>站位 / 職業</strong>
          <span>
            {profile.position} / {JOB_NAME_LABEL[profile.job]}
          </span>
          {conventional ? null : <span className="badge warn">非常見組合</span>}
        </div>
        <div className="row ready-summary-row">
          <strong>啟用軌道</strong>
          <span>{enabled.length ? enabled.map((track) => track.name).join('、') : '無'}</span>
        </div>
        <div className="row ready-summary-row">
          <strong>倒數</strong>
          <span className="mono">{(countdownMs / 1000).toFixed(1)} 秒</span>
        </div>
        <div className="row ready-summary-row">
          <strong>實際偏移</strong>
          <span className="mono offset-text">{formatSecondsSigned(effectiveOffsetMs)}</span>
        </div>
        <div className="row ready-summary-row">
          <strong>你會聽到的提示</strong>
          <span>{cueCount} 句</span>
        </div>
      </dl>
    </Modal>
  );
}
