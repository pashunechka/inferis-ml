import { ref, shallowRef } from 'vue';
import type { InferenceOptions, ModelHandle } from 'inferis-ml';
import type { ShallowRef } from 'vue';
import type { UseInferenceReturn } from '../types.js';

export function useInference<TOutput = unknown>(
  model: ShallowRef<ModelHandle<TOutput> | null>,
): UseInferenceReturn<TOutput> {
  const result = shallowRef<TOutput | null>(null);
  const error = shallowRef<Error | null>(null);
  const isLoading = ref(false);

  async function run(input: unknown, options?: InferenceOptions): Promise<TOutput> {
    if (!model.value) {
      throw new Error('Model is not loaded');
    }

    isLoading.value = true;
    error.value = null;

    try {
      const output = await model.value.run(input, options);
      result.value = output;
      return output;
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      error.value = e;
      throw e;
    } finally {
      isLoading.value = false;
    }
  }

  function reset() {
    result.value = null;
    error.value = null;
    isLoading.value = false;
  }

  return { result, error, isLoading, run, reset };
}
