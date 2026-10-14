import { useEffect, type ReactNode } from 'react';
import { Pip } from '../ds';
import { useData } from '../lib/useData';

interface ScreenProps<T> {
  name: string;
  title: string;
  render: (data: T) => ReactNode;
  onData?: (generatedAt: string | null | undefined) => void;
}

/** Loads one baked JSON and shows Pip while loading or on error. */
export function Screen<T extends { generatedAt?: string | null }>({ name, title, render, onData }: ScreenProps<T>) {
  const state = useData<T>(name);
  const generatedAt = state.status === 'ready' ? (state.data.generatedAt ?? null) : undefined;
  useEffect(() => {
    onData?.(generatedAt);
  }, [generatedAt, onData]);
  if (state.status === 'loading') return <Pip pose="working" title="Loading..." />;
  if (state.status === 'error') {
    return <Pip pose="error" title={`${title} is not available`} hint="The baked data could not be read." />;
  }
  return <>{render(state.data)}</>;
}

export function EmptyState({ title }: { title: string }) {
  return <Pip pose="sleeping" title={title} hint="Nothing to show yet." />;
}
