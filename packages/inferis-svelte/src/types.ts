import type { Writable, Readable } from 'svelte/store';
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

export interface InferisContext {
  pool: Writable<WorkerPoolInterface | null>;
  capabilities: Writable<CapabilityReport | null>;
  isReady: Readable<boolean>;
  error: Writable<Error | null>;
}

export interface InferisOptions {
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
  model: Writable<ModelHandle<TOutput> | null>;
  state: Writable<ModelState | 'pending'>;
  progress: Writable<LoadProgressEvent | null>;
  error: Writable<Error | null>;
  load: () => Promise<void>;
  dispose: () => Promise<void>;
}

export interface UseInferenceReturn<TOutput = unknown> {
  result: Writable<TOutput | null>;
  error: Writable<Error | null>;
  isLoading: Writable<boolean>;
  run: (input: unknown, options?: InferenceOptions) => Promise<TOutput>;
  reset: () => void;
}

export interface UseStreamReturn<TOutput = unknown> {
  chunks: Writable<TOutput[]>;
  text: Writable<string>;
  isStreaming: Writable<boolean>;
  error: Writable<Error | null>;
  start: (input: unknown, options?: InferenceOptions) => void;
  stop: () => void;
  reset: () => void;
}

export interface UseMemoryBudgetReturn {
  totalMB: Writable<number>;
  allocatedMB: Writable<number>;
  availableMB: Writable<number>;
}
