import { setContext, getContext, onDestroy } from 'svelte';
import { writable, derived } from 'svelte/store';
import { createPool, detectCapabilities } from 'inferis-ml';
import type { CapabilityReport, WorkerPoolInterface } from 'inferis-ml';
import type { InferisContext, InferisOptions } from './types.js';

const INFERIS_KEY = Symbol('inferis');

export function createInferis(options: InferisOptions): InferisContext {
  const pool = writable<WorkerPoolInterface | null>(null);
  const capabilities = writable<CapabilityReport | null>(null);
  const error = writable<Error | null>(null);
  const isReady = derived(pool, ($pool) => $pool !== null);

  if (typeof window !== 'undefined') {
    Promise.all([
      createPool({ adapter: options.adapter, ...options.poolConfig }),
      detectCapabilities(),
    ]).then(([p, caps]) => {
      pool.set(p);
      capabilities.set(caps);
    }).catch((err) => {
      error.set(err instanceof Error ? err : new Error(String(err)));
    });
  }

  const ctx: InferisContext = { pool, capabilities, isReady, error };
  setContext(INFERIS_KEY, ctx);

  let poolInstance: WorkerPoolInterface | null = null;
  pool.subscribe((p) => { poolInstance = p; });

  onDestroy(() => {
    poolInstance?.terminate();
  });

  return ctx;
}

export function getInferis(): InferisContext {
  const ctx = getContext<InferisContext>(INFERIS_KEY);
  if (!ctx) {
    throw new Error('getInferis must be used within a component that called createInferis()');
  }
  return ctx;
}
