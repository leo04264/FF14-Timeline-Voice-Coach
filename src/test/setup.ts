import '@testing-library/jest-dom/vitest';

/**
 * jsdom has no Web Speech API. These stubs let BrowserTtsBackend run in tests:
 * `speak()` reports start/end so audio telemetry is exercised too.
 */
class FakeSpeechSynthesisUtterance {
  text: string;
  lang = '';
  rate = 1;
  pitch = 1;
  volume = 1;
  voice: unknown = null;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor(text: string) {
    this.text = text;
  }
}

if (typeof window !== 'undefined' && !('speechSynthesis' in window)) {
  const spoken: FakeSpeechSynthesisUtterance[] = [];

  Object.defineProperty(window, 'SpeechSynthesisUtterance', {
    writable: true,
    value: FakeSpeechSynthesisUtterance,
  });

  Object.defineProperty(window, 'speechSynthesis', {
    writable: true,
    value: {
      spoken,
      speak(utterance: FakeSpeechSynthesisUtterance) {
        spoken.push(utterance);
        utterance.onstart?.();
        utterance.onend?.();
      },
      cancel() {
        spoken.length = 0;
      },
      getVoices: () => [],
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    },
  });
}
