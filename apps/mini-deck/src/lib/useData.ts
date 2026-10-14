import { useEffect, useState } from 'react';

export type DataState<T> =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; data: T };

/** Load `public/data/<name>.json` (baked at build time, never fetched live elsewhere). */
export function useData<T>(name: string): DataState<T> {
  const [state, setState] = useState<DataState<T>>({ status: 'loading' });
  useEffect(() => {
    let alive = true;
    fetch(`${import.meta.env.BASE_URL}data/${name}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<T>;
      })
      .then((data) => alive && setState({ status: 'ready', data }))
      .catch(() => alive && setState({ status: 'error' }));
    return () => {
      alive = false;
    };
  }, [name]);
  return state;
}
