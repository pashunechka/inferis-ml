import { computed } from 'vue';
import { useInferis } from './useInferis.js';

export function useCapabilities() {
  const { capabilities } = useInferis();
  const isLoading = computed(() => capabilities.value === null);

  return { capabilities, isLoading };
}
