import { writable, get } from 'svelte/store';
import { readableToAsyncIter } from 'inferis-ml';
import type { InferenceOptions, ModelHandle } from 'inferis-ml';
import type { Writable } from 'svelte/store';
import type { UseStreamReturn } from '../types.js';

export function useStream<TOutput = unknown>(
  model: Writable<ModelHandle<TOutput> | null>,
): UseStreamReturn<TOutput> {
  const chunks = writable<TOutput[]>([]);
  const text = writable('');
  const isStreaming = writable(false);
  const error = writable<Error | null>(null);

  let abortController: AbortController | null = null;

  function start(input: unknown, options?: InferenceOptions) {
    const m = get(model);
    if (!m) {
      throw new Error('Model is not loaded');
    }

    abortController?.abort();
    const controller = new AbortController();
    abortController = controller;

    chunks.set([]);
    text.set('');
    error.set(null);
    isStreaming.set(true);

    const stream = m.stream(input, { ...options, signal: controller.signal });

    (async () => {
      const collected: TOutput[] = [];
      try {
        for await (const chunk of readableToAsyncIter(stream)) {
          if (controller.signal.aborted) break;
          collected.push(chunk);
          chunks.set([...collected]);
          if (typeof chunk === 'string') {
            text.update((t) => t + chunk);
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        error.set(err instanceof Error ? err : new Error(String(err)));
      } finally {
        isStreaming.set(false);
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
    chunks.set([]);
    text.set('');
    isStreaming.set(false);
  }

  return { chunks, text, isStreaming, error, start, stop, reset };
}
