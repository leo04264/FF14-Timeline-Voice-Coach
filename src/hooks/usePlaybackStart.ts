import { useCallback, useEffect, useRef, useState } from 'react';
import type { OwnedAudioBackend } from '../audio/OwnedAudioBackend';
import type { EngineState, TimelineEngine } from '../engine/TimelineEngine';
import type { PlaybackPlanResult } from '../timeline/playbackPlan';

/**
 * The single formal start flow (spec §4.6).
 *
 * Every entry point — the big button, Space while idle, Quick Start — goes
 * through `requestStart()`. `engine.load() + engine.start()` happens in exactly
 * one place, guarded by a request token so a double click, a repeated key event
 * or a slow async step cannot add two pulls.
 *
 * A warning acknowledgement belongs to *one* request: the plan fingerprint is
 * captured when the dialog opens and re-checked before starting, so changing the
 * timeline, profile, tracks, countdown, audio, offset or collision window
 * silently invalidates it. There is deliberately no persistent
 * "skip all warnings" switch.
 */

export type StartStage = 'idle' | 'ready-summary' | 'risk-confirm' | 'blocked';

export interface PendingStart {
  stage: Exclude<StartStage, 'idle'>;
  token: number;
  /** Plan as it was when this request was raised. */
  plan: PlaybackPlanResult;
  /** Fingerprint captured with the plan; a change invalidates the request. */
  fingerprint: string;
  /** True once the inputs moved under an open dialog. */
  stale: boolean;
}

export interface UsePlaybackStartOptions {
  engine: TimelineEngine;
  ownedBackend: OwnedAudioBackend;
  engineState: EngineState;
  quickStart: boolean;
  /** Always reads the freshest plan; never a value captured in a closure. */
  getPlan(): PlaybackPlanResult | null;
}

export interface PlaybackStartController {
  pending: PendingStart | null;
  /** Ask to start a new pull. Safe to call repeatedly. */
  requestStart(): void;
  /** Confirm the open dialog. */
  confirm(): void;
  /** Dismiss the open dialog without starting. */
  cancel(): void;
  /** Invalidate any in-flight request (wipe, navigation, edits). */
  invalidate(): void;
  /** Space / big button: start, pause or resume as appropriate. */
  togglePlayback(): void;
  /** True while a modal is open, so shortcuts must stay off. */
  modalOpen: boolean;
}

export function usePlaybackStart(options: UsePlaybackStartOptions): PlaybackStartController {
  const { engine, ownedBackend, engineState, quickStart, getPlan } = options;

  const [pending, setPending] = useState<PendingStart | null>(null);
  const tokenRef = useRef(0);
  /** Token of the request that actually reached the engine. */
  const startedTokenRef = useRef<number | null>(null);
  const getPlanRef = useRef(getPlan);
  getPlanRef.current = getPlan;

  const nextToken = useCallback(() => {
    tokenRef.current += 1;
    return tokenRef.current;
  }, []);

  const invalidate = useCallback(() => {
    // Bumping the token makes every in-flight confirmation a no-op.
    tokenRef.current += 1;
    setPending(null);
  }, []);

  /** The one place a pull is really created. */
  const commitStart = useCallback(
    (plan: PlaybackPlanResult, token: number): void => {
      if (token !== tokenRef.current) return; // superseded
      if (startedTokenRef.current === token) return; // already started
      if (!plan.compiledTimeline || !plan.canStart) return;
      if (engine.getSnapshot().state !== 'idle') return; // never restart mid-pull

      startedTokenRef.current = token;
      setPending(null);
      // Take the synthesiser *before* load(), so the Chrome warm-up inside
      // prepare() runs while playback owns the device (spec §7.3).
      ownedBackend.acquireForPlayback();
      engine.load(plan.compiledTimeline);
      engine.start();
    },
    [engine, ownedBackend],
  );

  const requestStart = useCallback((): void => {
    if (engine.getSnapshot().state !== 'idle') return;
    // Re-entrancy guard: an open dialog owns the current request.
    if (pending && !pending.stale) return;

    const plan = getPlanRef.current();
    const token = nextToken();

    if (!plan) {
      setPending(null);
      return;
    }

    if (plan.errors.length > 0 || !plan.canStart) {
      setPending({
        stage: 'blocked',
        token,
        plan,
        fingerprint: plan.fingerprint,
        stale: false,
      });
      return;
    }

    if (plan.requiresConfirmation) {
      // Quick Start never skips this (spec §4.6).
      setPending({
        stage: 'risk-confirm',
        token,
        plan,
        fingerprint: plan.fingerprint,
        stale: false,
      });
      return;
    }

    if (!quickStart) {
      setPending({
        stage: 'ready-summary',
        token,
        plan,
        fingerprint: plan.fingerprint,
        stale: false,
      });
      return;
    }

    commitStart(plan, token);
  }, [commitStart, engine, nextToken, pending, quickStart]);

  const confirm = useCallback((): void => {
    const current = pending;
    if (!current || current.stage === 'blocked') return;
    if (current.token !== tokenRef.current) return;

    // Re-check against the live inputs: if anything moved while the dialog was
    // open, run the whole flow again instead of starting a stale plan.
    const fresh = getPlanRef.current();
    if (!fresh) {
      setPending(null);
      return;
    }
    if (fresh.fingerprint !== current.fingerprint) {
      const token = nextToken();
      if (fresh.errors.length > 0 || !fresh.canStart) {
        setPending({ stage: 'blocked', token, plan: fresh, fingerprint: fresh.fingerprint, stale: false });
      } else if (fresh.requiresConfirmation) {
        setPending({ stage: 'risk-confirm', token, plan: fresh, fingerprint: fresh.fingerprint, stale: false });
      } else {
        commitStart(fresh, token);
      }
      return;
    }

    commitStart(fresh, current.token);
  }, [commitStart, nextToken, pending]);

  const cancel = useCallback((): void => {
    invalidate();
  }, [invalidate]);

  const togglePlayback = useCallback((): void => {
    const state = engine.getSnapshot().state;
    if (state === 'idle') {
      requestStart();
      return;
    }
    if (state === 'paused') {
      // Resume the frozen plan; never re-load, never a new pull (spec §4.6.9).
      engine.resume();
      return;
    }
    if (state === 'countdown' || state === 'running') {
      engine.pause();
      return;
    }
    // 'completed' requires an explicit reset first.
  }, [engine, requestStart]);

  // A pull that ended (or a wipe) clears any leftover request and lets the next
  // start be a genuinely new one.
  useEffect(() => {
    if (engineState === 'idle') {
      startedTokenRef.current = null;
      return;
    }
    if (engineState !== 'countdown' && engineState !== 'running' && engineState !== 'paused') {
      setPending(null);
    }
  }, [engineState]);

  // Mark an open dialog stale as soon as the inputs it was built from change.
  const liveFingerprint = getPlan()?.fingerprint ?? null;
  useEffect(() => {
    if (!pending || pending.stale) return;
    if (liveFingerprint === null) return;
    if (liveFingerprint === pending.fingerprint) return;
    setPending((current) => (current ? { ...current, stale: true } : current));
  }, [liveFingerprint, pending]);

  return {
    pending,
    requestStart,
    confirm,
    cancel,
    invalidate,
    togglePlayback,
    modalOpen: pending !== null,
  };
}
