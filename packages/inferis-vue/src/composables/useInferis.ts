import { inject } from 'vue';
import { INFERIS_KEY } from '../injection.js';
import type { InferisContext } from '../types.js';

export function useInferis(): InferisContext {
  const ctx = inject(INFERIS_KEY);
  if (!ctx) {
    throw new Error('useInferis must be used within provideInferis() or inferisPlugin');
  }
  return ctx;
}
