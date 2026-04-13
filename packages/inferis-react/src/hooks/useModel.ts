import { useCallback, useEffect, useRef, useState } from 'react';
import type { LoadProgressEvent, ModelHandle, ModelState } from 'inferis-ml';
import { useInferis } from './useInferis.js';
import type { UseModelConfig, UseModelReturn } from '../types.js';

export function useModel<TOutput = unknown>(
  task: string,
  config: UseModelConfig,
): UseModelReturn<TOutput> {
  const { pool } = useInferis();
  const [model, setModel] = useState<ModelHandle<TOutput> | null>(null);
  const [state, setState] = useState<ModelState | 'pending'>('pending');
  const [progress, setProgress] = useState<LoadProgressEvent | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const modelRef = useRef<ModelHandle<TOutput> | null>(null);
  const configRef = useRef(config);
  configRef.current = config;
  const disposedRef = useRef(false);

  const load = useCallback(async () => {
    if (!pool) return;

    disposedRef.current = false;
    setState('loading');
    setError(null);
    setProgress(null);

    try {
      const { autoLoad: _, options, ...loadConfig } = configRef.current;
      const handle = await pool.load<TOutput>(task, {
        ...loadConfig,
        ...options,
        onProgress: (e) => {
          if (!disposedRef.current) setProgress(e);
        },
      });

      if (disposedRef.current) {
        await handle.dispose();
        return;
      }

      modelRef.current = handle;
      setModel(handle);
      setState(handle.state);

      handle.onStateChange((s) => {
        if (!disposedRef.current) setState(s);
      });
    } catch (err) {
      if (!disposedRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
        setState('error');
      }
    }
  }, [pool, task]);

  const dispose = useCallback(async () => {
    disposedRef.current = true;
    if (modelRef.current) {
      await modelRef.current.dispose();
      modelRef.current = null;
      setModel(null);
      setState('disposed');
    }
  }, []);

  useEffect(() => {
    if (config.autoLoad && pool) {
      load();
    }
    return () => {
      disposedRef.current = true;
      modelRef.current?.dispose();
      modelRef.current = null;
    };
  }, [config.autoLoad, pool, load]);

  return { model, state, progress, error, load, dispose };
}
