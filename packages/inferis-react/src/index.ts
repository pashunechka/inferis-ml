'use client';

export { InferisProvider } from './context/InferisProvider.js';
export { InferisContext } from './context/InferisContext.js';

export { useInferis } from './hooks/useInferis.js';
export { useCapabilities } from './hooks/useCapabilities.js';
export { useModel } from './hooks/useModel.js';
export { useInference } from './hooks/useInference.js';
export { useStream } from './hooks/useStream.js';
export { useMemoryBudget } from './hooks/useMemoryBudget.js';

export type {
  InferisContextValue,
  InferisProviderProps,
  UseModelConfig,
  UseModelReturn,
  UseInferenceReturn,
  UseStreamReturn,
  UseMemoryBudgetReturn,
} from './types.js';
