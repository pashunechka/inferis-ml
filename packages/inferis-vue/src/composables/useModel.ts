import { onScopeDispose, ref, shallowRef, watch } from 'vue';
import type { LoadProgressEvent, ModelHandle, ModelState } from 'inferis-ml';
import { useInferis } from './useInferis.js';
import type { UseModelConfig, UseModelReturn } from '../types.js';

export function useModel<TOutput = unknown>(
  task: string,
  config: UseModelConfig,
): UseModelReturn<TOutput> {
  const { pool, isReady } = useInferis();

  const model = shallowRef<ModelHandle<TOutput> | null>(null);
  const state = ref<ModelState | 'pending'>('pending');
  const progress = shallowRef<LoadProgressEvent | null>(null);
  const error = shallowRef<Error | null>(null);

  async function load() {
    if (!pool.value) return;

    state.value = 'loading';
    error.value = null;
    progress.value = null;

    try {
      const { autoLoad: _, options, ...loadConfig } = config;
      const handle = await pool.value.load<TOutput>(task, {
        ...loadConfig,
        ...options,
        onProgress: (e: LoadProgressEvent) => {
          progress.value = e;
        },
      });

      model.value = handle;
      state.value = handle.state;

      handle.onStateChange((s: ModelState) => {
        state.value = s;
      });
    } catch (err) {
      error.value = err instanceof Error ? err : new Error(String(err));
      state.value = 'error';
    }
  }

  async function dispose() {
    if (model.value) {
      await model.value.dispose();
      model.value = null;
      state.value = 'disposed';
    }
  }

  if (config.autoLoad) {
    watch(isReady, (ready) => {
      if (ready && !model.value) {
        load();
      }
    }, { immediate: true });
  }

  onScopeDispose(() => {
    model.value?.dispose();
  });

  return { model, state, progress, error, load, dispose };
}
