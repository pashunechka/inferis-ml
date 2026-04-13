import { ref, shallowRef } from 'vue';
import { readableToAsyncIter } from 'inferis-ml';
import type { InferenceOptions, ModelHandle } from 'inferis-ml';
import type { ShallowRef } from 'vue';
import type { UseStreamReturn } from '../types.js';

export function useStream<TOutput = unknown>(
  model: ShallowRef<ModelHandle<TOutput> | null>,
): UseStreamReturn<TOutput> {
  const chunks = shallowRef<TOutput[]>([]);
  const text = ref('');
  const isStreaming = ref(false);
  const error = shallowRef<Error | null>(null);

  let abortController: AbortController | null = null;

  function start(input: unknown, options?: InferenceOptions) {
    if (!model.value) {
      throw new Error('Model is not loaded');
    }

    abortController?.abort();
    const controller = new AbortController();
    abortController = controller;

    chunks.value = [];
    text.value = '';
    error.value = null;
    isStreaming.value = true;

    const stream = model.value.stream(input, { ...options, signal: controller.signal });

    (async () => {
      const collected: TOutput[] = [];
      try {
        for await (const chunk of readableToAsyncIter(stream)) {
          if (controller.signal.aborted) break;
          collected.push(chunk);
          chunks.value = [...collected];
          if (typeof chunk === 'string') {
            text.value += chunk;
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        error.value = err instanceof Error ? err : new Error(String(err));
      } finally {
        isStreaming.value = false;
        if (abortController === controller) {
          abortController = null;
        }
      }
    })();
  }

  function stop() {
    abortController?.abort();
    abortController = null;
  }

  function reset() {
    stop();
    chunks.value = [];
    text.value = '';
    isStreaming.value = false;
  }

  return { chunks, text, isStreaming, error, start, stop, reset };
}
