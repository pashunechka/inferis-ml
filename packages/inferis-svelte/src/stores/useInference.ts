import { writable, get } from 'svelte/store';
import type { InferenceOptions, ModelHandle } from 'inferis-ml';
import type { Writable } from 'svelte/store';
import type { UseInferenceReturn } from '../types.js';

export function useInference<TOutput = unknown>(
  model: Writable<ModelHandle<TOutput> | null>,
): UseInferenceReturn<TOutput> {
  const result = writable<TOutput | null>(null);
  const error = writable<Error | null>(null);
  const isLoading = writable(false);

  async function run(input: unknown, options?: InferenceOptions): Promise<TOutput> {
    const m = get(model);
    if (!m) {
      throw new Error('Model is not loaded');
    }

    isLoading.set(true);
    error.set(null);

    try {
      const output = await m.run(input, options);
      result.set(output);
      return output;
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      error.set(e);
      throw e;
    } finally {
      isLoading.set(false);
    }
  }

  function reset() {
    result.set(null);
    error.set(null);
    isLoading.set(false);
  }

  return { result, error, isLoading, run, reset };
}
