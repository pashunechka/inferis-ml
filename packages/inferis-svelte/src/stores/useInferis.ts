import { getInferis } from '../context.js';
import type { InferisContext } from '../types.js';

export function useInferis(): InferisContext {
  return getInferis();
}
