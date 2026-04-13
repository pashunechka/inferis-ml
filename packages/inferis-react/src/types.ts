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

export interface InferisContextValue {
  pool: WorkerPoolInterface | null;
  capabilities: CapabilityReport | null;
  isReady: boolean;
  error: Error | null;
}

export interface InferisProviderProps {
  adapter: ModelAdapterFactory;
  poolConfig?: Omit<Partial<PoolConfig>, 'adapter'>;
  children: React.ReactNode;
}

export interface UseModelConfig {
  model: string;
  autoLoad?: boolean;
  estimatedMemoryMB?: number;
  options?: Record<string, unknown>;
}

export interface UseModelReturn<TOutput = unknown> {
  model: ModelHandle<TOutput> | null;
  state: ModelState | 'pending';
  progress: LoadProgressEvent | null;
  error: Error | null;
  load: () => Promise<void>;
  dispose: () => Promise<void>;
}

export interface UseInferenceReturn<TOutput = unknown> {
  result: TOutput | null;
  error: Error | null;
  isLoading: boolean;
  run: (input: unknown, options?: InferenceOptions) => Promise<TOutput>;
  reset: () => void;
}

export interface UseStreamReturn<TOutput = unknown> {
  chunks: TOutput[];
  text: string;
  isStreaming: boolean;
  start: (input: unknown, options?: InferenceOptions) => void;
  stop: () => void;
  reset: () => void;
}

export interface UseMemoryBudgetReturn {
  totalMB: number;
  allocatedMB: number;
  availableMB: number;
}
