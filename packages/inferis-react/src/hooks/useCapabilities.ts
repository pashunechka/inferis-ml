import { useContext } from 'react';
import { InferisContext } from '../context/InferisContext.js';

export function useCapabilities() {
  const ctx = useContext(InferisContext);
  if (!ctx) {
    throw new Error('useCapabilities must be used within <InferisProvider>');
  }
  return {
    capabilities: ctx.capabilities,
    isLoading: !ctx.capabilities && !ctx.isReady,
  };
}
