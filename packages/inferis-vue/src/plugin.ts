import type { Plugin } from 'vue';
import { computed, shallowRef } from 'vue';
import { createPool, detectCapabilities } from 'inferis-ml';
import type { CapabilityReport, WorkerPoolInterface } from 'inferis-ml';
import { INFERIS_KEY } from './injection.js';
import type { InferisPluginOptions } from './types.js';

export const inferisPlugin: Plugin<[InferisPluginOptions]> = {
  install(app, options) {
    const pool = shallowRef<WorkerPoolInterface | null>(null);
    const capabilities = shallowRef<CapabilityReport | null>(null);
    const error = shallowRef<Error | null>(null);
    const isReady = computed(() => pool.value !== null);

    app.provide(INFERIS_KEY, { pool, capabilities, isReady, error });

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

    app.onUnmount?.(() => {
      pool.value?.terminate();
    });
  },
};
