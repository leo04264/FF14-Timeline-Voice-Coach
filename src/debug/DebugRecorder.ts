import type { AudioTelemetryEvent } from '../audio/AudioBackend';
import type { EngineEvent } from '../engine/TimelineEngine';
import type { DebugCueRecord } from './types';

/**
 * Correlates engine cue dispatch with audio telemetry into one record per cue
 * (spec §49, §50). Kept outside the engine so the runtime stays free of
 * debug concerns.
 *
 * WIPE never clears history — only "Clear Debug" does (spec §53).
 */
export class DebugRecorder {
  private records: DebugCueRecord[] = [];
  private nextRecordId = 1;
  /** cueId -> records waiting for their `requested` telemetry event. */
  private readonly pendingByCueId = new Map<string, DebugCueRecord[]>();
  private readonly byPlaybackId = new Map<number, DebugCueRecord>();
  private readonly listeners = new Set<() => void>();
  private snapshot: DebugCueRecord[] = [];

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): DebugCueRecord[] => this.snapshot;

  handleEngineEvent = (event: EngineEvent): void => {
    if (event.type === 'cue-fired') {
      const record: DebugCueRecord = {
        recordId: this.nextRecordId++,
        pullId: event.pullId,
        cueId: event.cue.id,
        eventName: event.cue.eventName,
        text: event.cue.text,
        triggerMs: event.cue.triggerMs,
        timelineElapsedMs: event.timelineElapsedMs,
        engineLateMs: event.engineLateMs,
        requestedAtMs: event.atMs,
        visibilityTrigger: event.visibilityState,
        status: 'pending',
      };
      this.records.push(record);
      const pending = this.pendingByCueId.get(record.cueId);
      if (pending) pending.push(record);
      else this.pendingByCueId.set(record.cueId, [record]);
      this.publish();
      return;
    }

    if (event.type === 'cue-skipped') {
      this.records.push({
        recordId: this.nextRecordId++,
        pullId: event.pullId,
        cueId: event.cue.id,
        eventName: event.cue.eventName,
        text: event.cue.text,
        triggerMs: event.cue.triggerMs,
        timelineElapsedMs: event.timelineElapsedMs,
        engineLateMs: event.lateByMs,
        requestedAtMs: event.atMs,
        visibilityTrigger: event.visibilityState,
        status: 'skipped',
      });
      this.publish();
    }
  };

  handleAudioTelemetry = (event: AudioTelemetryEvent): void => {
    if (event.phase === 'requested') {
      const pending = this.pendingByCueId.get(event.cueId);
      const record = pending?.shift();
      if (!record) return;
      record.playbackId = event.playbackId;
      this.byPlaybackId.set(event.playbackId, record);
      // Prefer the backend's own request timestamp for the queue-delay baseline.
      record.requestedAtMs = event.atMs;
      this.publish();
      return;
    }

    const record = this.byPlaybackId.get(event.playbackId);
    if (!record) return;

    if (event.phase === 'started') {
      record.audioStartAtMs = event.atMs;
      record.ttsQueueDelayMs = event.atMs - record.requestedAtMs;
      record.approxAudibleLateMs = record.engineLateMs + record.ttsQueueDelayMs;
      record.visibilityAudioStart = event.visibilityState;
      record.status = 'played';
    } else if (event.phase === 'ended') {
      record.audioEndAtMs = event.atMs;
      if (record.status === 'pending') record.status = 'played';
    } else if (event.phase === 'error') {
      record.status = 'error';
      record.error = event.error ?? 'unknown audio error';
      record.visibilityAudioStart = event.visibilityState;
    }
    this.publish();
  };

  getRecords(): DebugCueRecord[] {
    return this.records;
  }

  clear(): void {
    this.records = [];
    this.pendingByCueId.clear();
    this.byPlaybackId.clear();
    this.nextRecordId = 1;
    this.publish();
  }

  private publish(): void {
    this.snapshot = [...this.records];
    for (const listener of this.listeners) listener();
  }
}
