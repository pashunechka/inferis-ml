import type {
  CapabilityReport,
  InferenceOptions,
  LoadProgressEvent,
  ModelAdapterFactory,
  ModelHandle,
  ModelState,
  PoolConfig,
  WorkerPoolInterface,
} from 'inferis-ml';
import type { ComputedRef, Ref, ShallowRef } from 'vue';

export interface InferisContext {
  pool: ShallowRef<WorkerPoolInterface | null>;
  capabilities: ShallowRef<CapabilityReport | null>;
  isReady: ComputedRef<boolean>;
  error: ShallowRef<Error | null>;
}

export interface InferisPluginOptions {
  adapter: ModelAdapterFactory;
  poolConfig?: Omit<Partial<PoolConfig>, 'adapter'>;
}

export interface UseModelConfig {
  model: string;
  autoLoad?: boolean;
  estimatedMemoryMB?: number;
  options?: Record<string, unknown>;
}

export interface UseModelReturn<TOutput = unknown> {
  model: ShallowRef<ModelHandle<TOutput> | null>;
  state: Ref<ModelState | 'pending'>;
  progress: ShallowRef<LoadProgressEvent | null>;
  error: ShallowRef<Error | null>;
  load: () => Promise<void>;
  dispose: () => Promise<void>;
}

export interface UseInferenceReturn<TOutput = unknown> {
  result: ShallowRef<TOutput | null>;
  error: ShallowRef<Error | null>;
  isLoading: Ref<boolean>;
  run: (input: unknown, options?: InferenceOptions) => Promise<TOutput>;
  reset: () => void;
}

export interface UseStreamReturn<TOutput = unknown> {
  chunks: ShallowRef<TOutput[]>;
  text: Ref<string>;
  isStreaming: Ref<boolean>;
  error: ShallowRef<Error | null>;
  start: (input: unknown, options?: InferenceOptions) => void;
  stop: () => void;
  reset: () => void;
}

export interface UseMemoryBudgetReturn {
  totalMB: Ref<number>;
  allocatedMB: Ref<number>;
  availableMB: Ref<number>;
}
