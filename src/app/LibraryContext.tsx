import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { LocalStorageTimelineRepository } from '../storage/LocalStorageTimelineRepository';
import { loadBuiltinTimelines } from '../storage/builtinTimelines';
import type { TimelineEntry, TimelineRepository } from '../storage/TimelineRepository';
import type { TimelinePackage } from '../timeline/types';

interface LibraryContextValue {
  repository: TimelineRepository;
  entries: TimelineEntry[];
  builtins: TimelineEntry[];
  locals: TimelineEntry[];
  loading: boolean;
  refresh(): Promise<void>;
  getEntry(id: string): TimelineEntry | undefined;
  saveTimeline(timeline: TimelinePackage): Promise<void>;
  deleteTimeline(id: string): Promise<void>;
}

const LibraryContext = createContext<LibraryContextValue | null>(null);

export function LibraryProvider({
  children,
  repository: injected,
}: {
  children: ReactNode;
  repository?: TimelineRepository;
}) {
  const repository = useMemo<TimelineRepository>(
    () => injected ?? new LocalStorageTimelineRepository(),
    [injected],
  );
  const [locals, setLocals] = useState<TimelineEntry[]>([]);
  const [builtins, setBuiltins] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [localEntries, builtinEntries] = await Promise.all([
      repository.getAll(),
      loadBuiltinTimelines(),
    ]);
    setLocals(localEntries);
    // A local copy of a built-in id wins — built-ins are only templates.
    const localIds = new Set(localEntries.map((entry) => entry.id));
    setBuiltins(builtinEntries.filter((entry) => !localIds.has(entry.id)));
    setLoading(false);
  }, [repository]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const saveTimeline = useCallback(
    async (timeline: TimelinePackage) => {
      await repository.save(timeline);
      await refresh();
    },
    [repository, refresh],
  );

  const deleteTimeline = useCallback(
    async (id: string) => {
      await repository.delete(id);
      await refresh();
    },
    [repository, refresh],
  );

  const entries = useMemo(() => [...locals, ...builtins], [locals, builtins]);

  const value = useMemo<LibraryContextValue>(
    () => ({
      repository,
      entries,
      builtins,
      locals,
      loading,
      refresh,
      getEntry: (id: string) => entries.find((entry) => entry.id === id),
      saveTimeline,
      deleteTimeline,
    }),
    [repository, entries, builtins, locals, loading, refresh, saveTimeline, deleteTimeline],
  );

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary(): LibraryContextValue {
  const context = useContext(LibraryContext);
  if (!context) throw new Error('useLibrary must be used inside LibraryProvider');
  return context;
}
