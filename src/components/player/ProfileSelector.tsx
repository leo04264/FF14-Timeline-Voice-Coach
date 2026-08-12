import { JOB_NAME_LABEL, JOB_ROLE_LABEL } from '../../i18n/labels';
import { isConventionalAssignment } from '../../timeline/target';
import { JOB_CODES, JOB_ROLE, PARTY_POSITIONS } from '../../timeline/types';
import type { JobCode, PartyPosition, PlayerProfile } from '../../timeline/types';

interface ProfileSelectorProps {
  profile: PlayerProfile;
  onChange(profile: PlayerProfile): void;
  disabled?: boolean;
}

/**
 * Position + Job. Unconventional combinations warn but are never blocked
 * (spec §8) — odd setups are needed for testing.
 */
export function ProfileSelector({ profile, onChange, disabled }: ProfileSelectorProps) {
  const conventional = isConventionalAssignment(profile.position, profile.job);

  return (
    <div className="col">
      <div className="row">
        <label className="field">
          站位
          <select
            value={profile.position}
            disabled={disabled}
            aria-label="站位"
            onChange={(event) =>
              onChange({ ...profile, position: event.target.value as PartyPosition })
            }
          >
            {PARTY_POSITIONS.map((position) => (
              <option key={position} value={position}>
                {position}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          職業
          <select
            value={profile.job}
            disabled={disabled}
            aria-label="職業"
            onChange={(event) => onChange({ ...profile, job: event.target.value as JobCode })}
          >
            {JOB_CODES.map((job) => (
              <option key={job} value={job}>
                {JOB_NAME_LABEL[job]}（{JOB_ROLE_LABEL[JOB_ROLE[job]]}）
              </option>
            ))}
          </select>
        </label>
      </div>

      {conventional ? null : (
        <p className="small text-warn" role="status">
          警告：{profile.position} + {JOB_NAME_LABEL[profile.job]} 不是常見組合。仍然可以使用，語音提示照常播放。
        </p>
      )}
    </div>
  );
}
