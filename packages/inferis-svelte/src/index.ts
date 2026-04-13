export { createInferis, getInferis } from './context.js';

export { useInferis } from './stores/useInferis.js';
export { useCapabilities } from './stores/useCapabilities.js';
export { useModel } from './stores/useModel.js';
export { useInference } from './stores/useInference.js';
export { useStream } from './stores/useStream.js';
export { useMemoryBudget } from './stores/useMemoryBudget.js';

export type {
  InferisContext,
  InferisOptions,
  UseModelConfig,
  UseModelReturn,
  UseInferenceReturn,
  UseStreamReturn,
  UseMemoryBudgetReturn,
} from './types.js';
