import { JOB_CODES, PARTY_POSITIONS, type CueTarget, type JobCode, type PartyPosition } from '../../timeline/types';

interface TargetEditorProps {
  label: string;
  target: CueTarget | undefined;
  onChange(target: CueTarget | undefined): void;
}

/**
 * Target editing. "Any" is expressed by leaving a dimension unset — that is not
 * the same as an empty selection, which matches nobody (spec §19).
 */
export function TargetEditor({ label, target, onChange }: TargetEditorProps) {
  const positions = target?.positions;
  const jobs = target?.jobs;

  const emit = (next: CueTarget) => {
    const cleaned: CueTarget = {};
    if (next.positions) cleaned.positions = next.positions;
    if (next.jobs) cleaned.jobs = next.jobs;
    onChange(cleaned.positions || cleaned.jobs ? cleaned : undefined);
  };

  const togglePosition = (position: PartyPosition) => {
    const current = positions ?? [];
    emit({
      positions: current.includes(position)
        ? current.filter((value) => value !== position)
        : [...current, position],
      jobs,
    });
  };

  const toggleJob = (job: JobCode) => {
    const current = jobs ?? [];
    emit({
      positions,
      jobs: current.includes(job) ? current.filter((value) => value !== job) : [...current, job],
    });
  };

  return (
    <div className="col" style={{ gap: '0.3rem' }}>
      <div className="row">
        <strong className="small">{label}</strong>
        <span className="muted small">
          {positions || jobs ? '（站位 任一）且（職業 任一）' : '所有人'}
        </span>
      </div>

      <div className="row" style={{ gap: '0.25rem' }}>
        <button
          type="button"
          className={positions ? '' : 'active'}
          onClick={() => emit({ positions: undefined, jobs })}
        >
          不限站位
        </button>
        {PARTY_POSITIONS.map((position) => (
          <button
            type="button"
            key={position}
            className={positions?.includes(position) ? 'active' : ''}
            onClick={() => togglePosition(position)}
          >
            {position}
          </button>
        ))}
      </div>

      <div className="row" style={{ gap: '0.25rem' }}>
        <button
          type="button"
          className={jobs ? '' : 'active'}
          onClick={() => emit({ positions, jobs: undefined })}
        >
          不限職業
        </button>
        {JOB_CODES.map((job) => (
          <button
            type="button"
            key={job}
            className={jobs?.includes(job) ? 'active' : ''}
            onClick={() => toggleJob(job)}
          >
            {job}
          </button>
        ))}
      </div>

      {positions?.length === 0 || jobs?.length === 0 ? (
        <span className="small text-warn">
          一個都沒選代表沒有人會聽到，要對所有人播放請按「不限」。
        </span>
      ) : null}
    </div>
  );
}
