import { derived } from 'svelte/store';
import { getInferis } from '../context.js';

export function useCapabilities() {
  const { capabilities } = getInferis();
  const isLoading = derived(capabilities, ($c) => $c === null);

  return { capabilities, isLoading };
}
