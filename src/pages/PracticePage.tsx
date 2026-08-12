import { PlayerView } from '../components/player/PlayerView';

/** Same runtime as the live player, plus Pause and an open debug panel (spec §40). */
export function PracticePage() {
  return <PlayerView mode="practice" />;
}
