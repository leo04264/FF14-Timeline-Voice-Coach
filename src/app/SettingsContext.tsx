import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type AppSettings } from '../storage/settings';

interface SettingsContextValue {
  settings: AppSettings;
  update(patch: Partial<AppSettings>): void;
  reset(): void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());

  const update = useCallback((patch: Partial<AppSettings>) => {
    setSettings((current) => {
      const next: AppSettings = {
        ...current,
        ...patch,
        audio: { ...current.audio, ...(patch.audio ?? {}) },
      };
      saveSettings(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    const next = { ...DEFAULT_SETTINGS, audio: { ...DEFAULT_SETTINGS.audio } };
    saveSettings(next);
    setSettings(next);
  }, []);

  const value = useMemo<SettingsContextValue>(
    () => ({ settings, update, reset }),
    [settings, update, reset],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) throw new Error('useSettings must be used inside SettingsProvider');
  return context;
}
