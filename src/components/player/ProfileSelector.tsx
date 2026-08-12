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
          Party Position
          <select
            value={profile.position}
            disabled={disabled}
            aria-label="Party Position"
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
          Job
          <select
            value={profile.job}
            disabled={disabled}
            aria-label="Job"
            onChange={(event) => onChange({ ...profile, job: event.target.value as JobCode })}
          >
            {JOB_CODES.map((job) => (
              <option key={job} value={job}>
                {job} ({JOB_ROLE[job]})
              </option>
            ))}
          </select>
        </label>
      </div>

      {conventional ? null : (
        <p className="small text-warn" role="status">
          Warning: {profile.position} + {profile.job} is an unusual combination. It is allowed —
          cues still play normally.
        </p>
      )}
    </div>
  );
}
