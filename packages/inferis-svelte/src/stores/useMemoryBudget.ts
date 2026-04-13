import { onDestroy } from 'svelte';
import { writable, get } from 'svelte/store';
import { getInferis } from '../context.js';
import type { UseMemoryBudgetReturn } from '../types.js';

export function useMemoryBudget(intervalMs = 1000): UseMemoryBudgetReturn {
  const { pool } = getInferis();

  const totalMB = writable(0);
  const allocatedMB = writable(0);
  const availableMB = writable(0);

  function update() {
    const budget = get(pool)?.getMemoryBudget();
    if (budget) {
      totalMB.set(budget.totalMB);
      allocatedMB.set(budget.allocatedMB);
      availableMB.set(budget.availableMB);
    }
  }

  const timer = setInterval(update, intervalMs);
  update();

  onDestroy(() => {
    clearInterval(timer);
  });

  return { totalMB, allocatedMB, availableMB };
}
