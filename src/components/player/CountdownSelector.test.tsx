import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CountdownSelector } from './CountdownSelector';

/**
 * The player must not offer a countdown that makes the run impossible to start.
 * M5S H2 Scholar opens with a cue at -15s, so 5s and 10s cannot work for it.
 */
describe('倒數選擇器：蓋不住開場提示的選項要停用', () => {
  const base = {
    countdownMs: 16_000,
    timelineDefaultMs: 15_000,
    onChange: () => undefined,
  };

  it('沒有負時間提示時，所有選項都可以按', () => {
    render(<CountdownSelector {...base} minimumMs={0} />);
    for (const label of ['5 秒', '10 秒', '16 秒', '20 秒']) {
      expect(screen.getByRole('button', { name: label })).toBeEnabled();
    }
    expect(screen.queryByText(/比這個短的選項已停用/)).not.toBeInTheDocument();
  });

  it('需要 15 秒時，5 秒與 10 秒停用，15／16／20 秒仍可按', () => {
    render(<CountdownSelector {...base} minimumMs={15_000} />);
    expect(screen.getByRole('button', { name: '5 秒' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '10 秒' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '16 秒' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '20 秒' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '時間軸預設（15 秒）' })).toBeEnabled();
  });

  it('說明為什麼停用，而不是無聲變灰', () => {
    render(<CountdownSelector {...base} minimumMs={15_000} />);
    expect(screen.getByText(/最早的提示在 -15 秒/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '10 秒' }).getAttribute('title')).toBe(
      '這一場最早的提示在 -15 秒，這個倒數蓋不住它',
    );
    // 可以按的選項不該掛上這個說明
    expect(screen.getByRole('button', { name: '20 秒' }).getAttribute('title')).toBeNull();
  });

  it('停用的選項按不動，不會偷偷把倒數改掉', () => {
    const onChange = vi.fn();
    render(<CountdownSelector {...base} onChange={onChange} minimumMs={15_000} />);
    fireEvent.click(screen.getByRole('button', { name: '5 秒' }));
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '20 秒' }));
    expect(onChange).toHaveBeenCalledWith(20_000);
  });

  it('播放中整組都停用', () => {
    render(<CountdownSelector {...base} minimumMs={0} disabled />);
    expect(screen.getByRole('button', { name: '16 秒' })).toBeDisabled();
  });
});
