export { LeaderElection } from './coordination/leader-election.js';
export { SharedWorkerBridge } from './coordination/shared-bridge.js';
export { TabChannel } from './coordination/tab-channel.js';
export { MemoryBudget } from './core/budget.js';
export { clearCapabilitiesCache, detectCapabilities } from './core/capabilities.js';
export {
  BudgetExceededError,
  DeviceLostError,
  EnvironmentError,
  InferenceError,
  InferisError,
  InvalidStateTransitionError,
  ModelDisposedError,
  ModelLoadError,
  ModelNotReadyError,
  TaskTimeoutError,
  WorkerError,
} from './core/errors.js';
export { canTransition, isAcceptingInference, isTerminal, transition } from './core/lifecycle.js';
export { createPool, WorkerPool } from './core/pool.js';
export { ModelRegistry } from './core/registry.js';
export { Scheduler } from './core/scheduler.js';
export type {
  CapabilityReport,
  Device,
  InferenceOptions,
  LoadedModel,
  LoadProgressEvent,
  ModelAdapter,
  ModelAdapterFactory,
  ModelHandle,
  ModelLoadConfig,
  ModelState,
  PoolConfig,
  WasmCapability,
  WebGpuCapability,
  WorkerPoolInterface,
} from './core/types.js';
export { ProgressEmitter } from './streaming/progress-emitter.js';

export { collectStream, collectStreamText, readableToAsyncIter } from './streaming/token-stream.js';
