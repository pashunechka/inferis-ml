import { useContext } from 'react';
import { InferisContext } from '../context/InferisContext.js';

export function useInferis() {
  const ctx = useContext(InferisContext);
  if (!ctx) {
    throw new Error('useInferis must be used within <InferisProvider>');
  }
  return { pool: ctx.pool, isReady: ctx.isReady };
}
