import { computed, onScopeDispose, provide, shallowRef } from 'vue';
import { createPool, detectCapabilities } from 'inferis-ml';
import type { CapabilityReport, WorkerPoolInterface } from 'inferis-ml';
import type { InjectionKey } from 'vue';
import type { InferisContext, InferisPluginOptions } from './types.js';

export const INFERIS_KEY: InjectionKey<InferisContext> = Symbol('inferis');

export function provideInferis(options: InferisPluginOptions): InferisContext {
  const pool = shallowRef<WorkerPoolInterface | null>(null);
  const capabilities = shallowRef<CapabilityReport | null>(null);
  const error = shallowRef<Error | null>(null);
  const isReady = computed(() => pool.value !== null);

  if (typeof window !== 'undefined') {
    Promise.all([
      createPool({ adapter: options.adapter, ...options.poolConfig }),
      detectCapabilities(),
    ]).then(([p, caps]) => {
      pool.value = p;
      capabilities.value = caps;
    }).catch((err) => {
      error.value = err instanceof Error ? err : new Error(String(err));
    });
  }

  const ctx: InferisContext = { pool, capabilities, isReady, error };
  provide(INFERIS_KEY, ctx);

  onScopeDispose(() => {
    pool.value?.terminate();
  });

  return ctx;
}
