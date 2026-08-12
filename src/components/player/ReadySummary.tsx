import { Modal } from '../common/Modal';
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
      title="Ready?"
      onClose={onCancel}
      footer={
        <>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="primary" autoFocus onClick={onConfirm}>
            START
          </button>
        </>
      }
    >
      <dl className="col" style={{ margin: 0 }}>
        <div className="row">
          <strong style={{ minWidth: 140 }}>Timeline</strong>
          <span>{timelineName}</span>
        </div>
        <div className="row">
          <strong style={{ minWidth: 140 }}>Position / Job</strong>
          <span>
            {profile.position} / {profile.job}
          </span>
          {conventional ? null : <span className="badge warn">unusual</span>}
        </div>
        <div className="row">
          <strong style={{ minWidth: 140 }}>Tracks</strong>
          <span>{enabled.length ? enabled.map((track) => track.name).join(', ') : 'none'}</span>
        </div>
        <div className="row">
          <strong style={{ minWidth: 140 }}>Countdown</strong>
          <span className="mono">{(countdownMs / 1000).toFixed(1)}s</span>
        </div>
        <div className="row">
          <strong style={{ minWidth: 140 }}>Effective Offset</strong>
          <span className="mono">{formatSecondsSigned(effectiveOffsetMs)}</span>
        </div>
        <div className="row">
          <strong style={{ minWidth: 140 }}>Cues for you</strong>
          <span>{cueCount}</span>
        </div>
      </dl>
    </Modal>
  );
}
