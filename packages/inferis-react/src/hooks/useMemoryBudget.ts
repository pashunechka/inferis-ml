import { useCallback, useContext, useRef, useSyncExternalStore } from 'react';
import { InferisContext } from '../context/InferisContext.js';
import type { UseMemoryBudgetReturn } from '../types.js';

const EMPTY: UseMemoryBudgetReturn = { totalMB: 0, allocatedMB: 0, availableMB: 0 };

export function useMemoryBudget(): UseMemoryBudgetReturn {
  const ctx = useContext(InferisContext);
  if (!ctx) {
    throw new Error('useMemoryBudget must be used within <InferisProvider>');
  }

  const cachedRef = useRef<UseMemoryBudgetReturn>(EMPTY);

  const subscribe = useCallback((_onStoreChange: () => void) => {
    return () => {};
  }, []);

  const getSnapshot = useCallback(() => {
    const budget = ctx.pool?.getMemoryBudget();
    if (!budget) return EMPTY;

    const prev = cachedRef.current;
    if (
      prev.totalMB === budget.totalMB
      && prev.allocatedMB === budget.allocatedMB
      && prev.availableMB === budget.availableMB
    ) {
      return prev;
    }

    cachedRef.current = budget;
    return budget;
  }, [ctx.pool]);

  return useSyncExternalStore(subscribe, getSnapshot);
}