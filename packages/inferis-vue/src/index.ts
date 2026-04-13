export { inferisPlugin } from './plugin.js';
export { INFERIS_KEY, provideInferis } from './injection.js';

export { useInferis } from './composables/useInferis.js';
export { useCapabilities } from './composables/useCapabilities.js';
export { useModel } from './composables/useModel.js';
export { useInference } from './composables/useInference.js';
export { useStream } from './composables/useStream.js';
export { useMemoryBudget } from './composables/useMemoryBudget.js';

export type {
  InferisContext,
  InferisPluginOptions,
  UseModelConfig,
  UseModelReturn,
  UseInferenceReturn,
  UseStreamReturn,
  UseMemoryBudgetReturn,
} from './types.js';
