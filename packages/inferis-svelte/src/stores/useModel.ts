import { onDestroy } from 'svelte';
import { writable, get } from 'svelte/store';
import type { LoadProgressEvent, ModelHandle, ModelState } from 'inferis-ml';
import { getInferis } from '../context.js';
import type { UseModelConfig, UseModelReturn } from '../types.js';

export function useModel<TOutput = unknown>(
  task: string,
  config: UseModelConfig,
): UseModelReturn<TOutput> {
  const { pool, isReady } = getInferis();

  const model = writable<ModelHandle<TOutput> | null>(null);
  const state = writable<ModelState | 'pending'>('pending');
  const progress = writable<LoadProgressEvent | null>(null);
  const error = writable<Error | null>(null);

  async function load() {
    const p = get(pool);
    if (!p) return;

    state.set('loading');
    error.set(null);
    progress.set(null);

    try {
      const { autoLoad: _, options, ...loadConfig } = config;
      const handle = await p.load<TOutput>(task, {
        ...loadConfig,
        ...options,
        onProgress: (e: LoadProgressEvent) => {
          progress.set(e);
        },
      });

      model.set(handle);
      state.set(handle.state);

      handle.onStateChange((s: ModelState) => {
        state.set(s);
      });
    } catch (err) {
      error.set(err instanceof Error ? err : new Error(String(err)));
      state.set('error');
    }
  }

  async function dispose() {
    const m = get(model);
    if (m) {
      await m.dispose();
      model.set(null);
      state.set('disposed');
    }
  }

  if (config.autoLoad) {
    const unsub = isReady.subscribe(($ready) => {
      if ($ready && get(model) === null) {
        load();
      }
    });
    onDestroy(unsub);
  }

  onDestroy(() => {
    get(model)?.dispose();
  });

  return { model, state, progress, error, load, dispose };
}
