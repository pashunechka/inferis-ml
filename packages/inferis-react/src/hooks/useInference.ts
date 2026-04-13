import { useCallback, useRef, useState } from 'react';
import type { InferenceOptions, ModelHandle } from 'inferis-ml';
import type { UseInferenceReturn } from '../types.js';

export function useInference<TOutput = unknown>(
  model: ModelHandle<TOutput> | null,
): UseInferenceReturn<TOutput> {
  const [result, setResult] = useState<TOutput | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const modelRef = useRef(model);
  modelRef.current = model;

  const run = useCallback(async (input: unknown, options?: InferenceOptions): Promise<TOutput> => {
    if (!modelRef.current) {
      throw new Error('Model is not loaded');
    }

    setIsLoading(true);
    setError(null);

    try {
      const output = await modelRef.current.run(input, options);
      setResult(output);
      return output;
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      throw e;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
    setIsLoading(false);
  }, []);

  return { result, error, isLoading, run, reset };
}
