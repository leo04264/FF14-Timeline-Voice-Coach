import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { analyzeCollisions } from '../../timeline/collision';
import type { TimelinePackage } from '../../timeline/types';
import { validateTimeline } from '../../timeline/validator';
import { ValidationSummary } from './ValidationSummary';

const TIMELINE: TimelinePackage = {
  schemaVersion: 1,
  id: 'validation-summary-test',
  meta: { name: '問題清單測試', encounterId: 'test' },
  encounter: { durationMs: 60_000, countdownMs: 15_000 },
  tracks: [
    {
      id: 'track-boss',
      type: 'encounter',
      name: '王機制',
      enabledByDefault: true,
      events: [
        {
          id: 'event-opening',
          atMs: 10_000,
          name: '開場',
          category: 'mechanic',
          cues: [
            {
              id: 'cue-empty',
              offsetMs: 0,
              text: '',
              priority: 'normal',
            },
            {
              id: 'cue-stack',
              offsetMs: 500,
              text: '集合分攤',
              priority: 'normal',
            },
          ],
        },
      ],
    },
  ],
};

describe('ValidationSummary', () => {
  it('shows issue location, suggested fix and both sides of a collision', () => {
    const onSelectIssue = vi.fn();
    const onSelectCue = vi.fn();
    const report = validateTimeline(TIMELINE);
    const collisions = analyzeCollisions(TIMELINE, 2000);

    render(
      <ValidationSummary
        timeline={TIMELINE}
        report={report}
        collisions={collisions}
        onSelectIssue={onSelectIssue}
        onSelectCue={onSelectCue}
      />,
    );

    expect(screen.getByText('事件「開場」底下有空白的語音提示')).toBeInTheDocument();
    expect(screen.getByText('王機制')).toBeInTheDocument();
    expect(screen.getByText(/觸發於 00:10\.000/)).toBeInTheDocument();
    expect(screen.getByText(/在語音內容填入實際要念的文字/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '定位到問題' }));
    expect(onSelectIssue).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'cue.empty-text', cueId: 'cue-empty' }),
    );

    fireEvent.click(screen.getByText(/衝突清單（1）/));
    expect(screen.getByText(/兩句相隔 500 毫秒/)).toBeInTheDocument();
    expect(screen.getAllByText('「（空白提示）」').length).toBeGreaterThan(0);
    expect(screen.getByText('「集合分攤」')).toBeInTheDocument();
    expect(screen.getByText(/不會自動捨棄低優先度提示/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '定位第二句' }));
    expect(onSelectCue).toHaveBeenCalledWith('track-boss', 'event-opening', 'cue-stack');
  });
});
