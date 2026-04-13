import { useCallback, useRef, useState } from 'react';
import { readableToAsyncIter } from 'inferis-ml';
import type { InferenceOptions, ModelHandle } from 'inferis-ml';
import type { UseStreamReturn } from '../types.js';

export function useStream<TOutput = unknown>(
  model: ModelHandle<TOutput> | null,
): UseStreamReturn<TOutput> {
  const [chunks, setChunks] = useState<TOutput[]>([]);
  const [text, setText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);

  const modelRef = useRef(model);
  modelRef.current = model;
  const abortRef = useRef<AbortController | null>(null);
  const chunksRef = useRef<TOutput[]>([]);

  const start = useCallback((input: unknown, options?: InferenceOptions) => {
    if (!modelRef.current) {
      throw new Error('Model is not loaded');
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    chunksRef.current = [];
    setChunks([]);
    setText('');
    setIsStreaming(true);

    const m = modelRef.current;
    const stream = m.stream(input, { ...options, signal: controller.signal });

    (async () => {
      try {
        for await (const chunk of readableToAsyncIter(stream)) {
          if (controller.signal.aborted) break;
          chunksRef.current.push(chunk);
          setChunks([...chunksRef.current]);
          if (typeof chunk === 'string') {
            setText(prev => prev + chunk);
          }
        }
      } catch {
        // aborted or stream error
      } finally {
        setIsStreaming(false);
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      }
    })();
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const reset = useCallback(() => {
    stop();
    chunksRef.current = [];
    setChunks([]);
    setText('');
    setIsStreaming(false);
  }, [stop]);

  return { chunks, text, isStreaming, start, stop, reset };
}
