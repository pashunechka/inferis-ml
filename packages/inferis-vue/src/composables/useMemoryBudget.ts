import { onScopeDispose, ref } from 'vue';
import { useInferis } from './useInferis.js';
import type { UseMemoryBudgetReturn } from '../types.js';

export function useMemoryBudget(intervalMs = 1000): UseMemoryBudgetReturn {
  const { pool } = useInferis();

  const totalMB = ref(0);
  const allocatedMB = ref(0);
  const availableMB = ref(0);

  function update() {
    const budget = pool.value?.getMemoryBudget();
    if (budget) {
      totalMB.value = budget.totalMB;
      allocatedMB.value = budget.allocatedMB;
      availableMB.value = budget.availableMB;
    }
  }

  const timer = setInterval(update, intervalMs);
  update();

  onScopeDispose(() => {
    clearInterval(timer);
  });

  return { totalMB, allocatedMB, availableMB };
}
