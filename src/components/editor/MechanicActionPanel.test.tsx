import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EXAMPLE_TIMELINE } from '../../timeline/exampleTimeline';
import { MechanicActionPanel } from './MechanicActionPanel';

const bossTrack = EXAMPLE_TIMELINE.tracks.find((track) => track.id === 'example-track-boss')!;
const raidwide = bossTrack.events.find((event) => event.id === 'example-event-raidwide')!;

function renderPanel(
  overrides: Partial<React.ComponentProps<typeof MechanicActionPanel>> = {},
) {
  const props: React.ComponentProps<typeof MechanicActionPanel> = {
    timeline: EXAMPLE_TIMELINE,
    sourceTrack: bossTrack,
    sourceEvent: raidwide,
    collisionWindowMs: 2000,
    onChange: vi.fn(),
    onNavigate: vi.fn(),
    ...overrides,
  };
  render(<MechanicActionPanel {...props} />);
  return props;
}

describe('MechanicActionPanel', () => {
  it('adds one standard target-track event and reports where it went', async () => {
    const user = userEvent.setup();
    const props = renderPanel();

    await user.selectOptions(screen.getByLabelText('追加到軌道'), 'example-track-healer');
    await user.clear(screen.getByLabelText('動作名稱'));
    await user.type(screen.getByLabelText('動作名稱'), '全體攻擊：學者罩子');
    await user.type(screen.getByLabelText('語音內容'), '全體前罩子');
    const offset = screen.getByLabelText('提示相對時間（負數代表機制之前）');
    fireEvent.change(offset, { target: { value: '-00:12.000' } });
    fireEvent.blur(offset);

    await user.click(screen.getByRole('button', { name: '追加動作' }));

    expect(props.onChange).toHaveBeenCalledTimes(1);
    const next = vi.mocked(props.onChange).mock.calls[0][0];
    const healer = next.tracks.find((track) => track.id === 'example-track-healer');
    expect(healer?.events).toHaveLength(2);
    expect(healer?.events[1]).toMatchObject({
      atMs: 20_000,
      name: '全體攻擊：學者罩子',
      phase: 'P1',
      category: 'mitigation',
      cues: [expect.objectContaining({ offsetMs: -12_000, text: '全體前罩子' })],
    });
  });

  it('shows exact collision context and requires the explicit warning action', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.type(screen.getByLabelText('語音內容'), '放團減');

    expect(screen.getByRole('alert')).toHaveTextContent('相隔 2000 毫秒');
    expect(screen.getByRole('alert')).toHaveTextContent('王機制 › 全體攻擊／「五秒後全體攻擊」');
    expect(
      screen.getByRole('button', { name: '仍要追加（1 組衝突）' }),
    ).toBeInTheDocument();
  });

  it('lists same-time events and can navigate to another track', async () => {
    const user = userEvent.setup();
    const props = renderPanel();

    await user.click(screen.getByText(/此時間點已有 2 個其他軌道事件/));
    await user.click(screen.getByRole('button', { name: '前往編輯：全體減傷' }));

    expect(props.onNavigate).toHaveBeenCalledWith(
      'example-track-party-mit',
      'example-event-party-mit',
      'example-cue-party-mit',
    );
  });

  it('does not render for a non-encounter source track', () => {
    const healer = EXAMPLE_TIMELINE.tracks.find((track) => track.id === 'example-track-healer')!;
    const { container } = render(
      <MechanicActionPanel
        timeline={EXAMPLE_TIMELINE}
        sourceTrack={healer}
        sourceEvent={healer.events[0]}
        collisionWindowMs={2000}
        onChange={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
