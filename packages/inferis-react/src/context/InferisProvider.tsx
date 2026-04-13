import { useEffect, useMemo, useRef, useState } from 'react';
import { createPool, detectCapabilities } from 'inferis-ml';
import type { CapabilityReport, WorkerPoolInterface } from 'inferis-ml';
import { InferisContext } from './InferisContext.js';
import type { InferisProviderProps } from '../types.js';

export function InferisProvider({ adapter, poolConfig, children }: InferisProviderProps) {
  const [pool, setPool] = useState<WorkerPoolInterface | null>(null);
  const [capabilities, setCapabilities] = useState<CapabilityReport | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const adapterRef = useRef(adapter);
  const configRef = useRef(poolConfig);

  useEffect(() => {
    let disposed = false;
    let poolInstance: WorkerPoolInterface | null = null;

    async function init() {
      try {
        const [p, caps] = await Promise.all([
          createPool({ adapter: adapterRef.current, ...configRef.current }),
          detectCapabilities(),
        ]);

        if (disposed) {
          await p.terminate();
          return;
        }

        poolInstance = p;
        setPool(p);
        setCapabilities(caps);
      } catch (err) {
        if (!disposed) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      }
    }

    init();

    return () => {
      disposed = true;
      poolInstance?.terminate();
    };
  }, []);

  const value = useMemo(() => ({
    pool,
    capabilities,
    isReady: pool !== null,
    error,
  }), [pool, capabilities, error]);

  return (
    <InferisContext.Provider value={value}>
      {children}
    </InferisContext.Provider>
  );
}
