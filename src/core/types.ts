// ─── Model Lifecycle ──────────────────────────────────────────────────────────

export type ModelState
  = | 'idle'
    | 'loading'
    | 'ready'
    | 'inferring'
    | 'unloading'
    | 'error'
    | 'disposed';

// ─── Capability Detection ─────────────────────────────────────────────────────

export interface WebGpuCapability {
  readonly supported: boolean;
  readonly adapter: {
    readonly vendor: string;
    readonly architecture: string;
    readonly device: string;
    readonly description: string;
  } | null;
  readonly limits: {
    readonly maxBufferSize: number;
    readonly maxStorageBufferBindingSize: number;
  } | null;
  readonly isFallback: boolean;
}

export interface WasmCapability {
  readonly supported: boolean;
  readonly simd: boolean;
  readonly threads: boolean;
}

export interface CapabilityReport {
  readonly webgpu: WebGpuCapability;
  readonly wasm: WasmCapability;
  readonly sharedWorker: boolean;
  readonly broadcastChannel: boolean;
  readonly webLocks: boolean;
  readonly hardwareConcurrency: number;
}

// ─── Devices ─────────────────────────────────────────────────────────────────

export type Device = 'webgpu' | 'wasm';

// ─── Progress Events ─────────────────────────────────────────────────────────

export interface LoadProgressEvent {
  readonly phase: string;
  readonly loaded: number;
  readonly total: number;
}

// ─── Inference Options ────────────────────────────────────────────────────────

export interface InferenceOptions {
  readonly signal?: AbortSignal;
  readonly priority?: 'high' | 'normal' | 'low';
}

// ─── Pool Configuration ───────────────────────────────────────────────────────

export interface PoolConfig {
  /** Adapter factory for the AI runtime. Required. */
  readonly adapter: ModelAdapterFactory;
  /**
   * URL to the pre-built dedicated worker file.
   * Default: resolves `inferis/worker` relative to import.meta.url if available.
   */
  readonly workerUrl?: URL | string;
  /** Maximum number of dedicated workers. Default: hardwareConcurrency - 1, min 1. */
  readonly maxWorkers?: number;
  /** Maximum combined memory budget in MB. Default: 2048. */
  readonly maxMemoryMB?: number;
  /** Default inference device. 'auto' tries WebGPU first, falls back to WASM. Default: 'auto'. */
  readonly defaultDevice?: Device | 'auto';
  /** Enable cross-tab model deduplication. Default: false. */
  readonly crossTab?: boolean;
  /** Per-task timeout in milliseconds. Default: 120_000. */
  readonly taskTimeout?: number;
}

// ─── Model Load Config ────────────────────────────────────────────────────────

export interface ModelLoadConfig {
  /** Model identifier (e.g. HuggingFace model ID or URL). */
  readonly model: string;
  /** Estimated memory usage in MB. Used for pre-eviction budgeting. */
  readonly estimatedMemoryMB?: number;
  /** Progress callback for download and load phases. */
  readonly onProgress?: (event: LoadProgressEvent) => void;
  /** Additional adapter-specific config. */
  readonly [key: string]: unknown;
}

// ─── Model Handle ─────────────────────────────────────────────────────────────

export interface ModelHandle<TOutput = unknown> {
  /** Unique model instance ID. */
  readonly id: string;
  /** Current lifecycle state. */
  readonly state: ModelState;
  /** Approximate memory usage in MB. */
  readonly memoryMB: number;
  /** Resolved inference device. */
  readonly device: Device;

  /**
   * Run non-streaming inference.
   * @throws {InferisError} if the model is not in 'ready' state.
   * @throws {AbortError} if the signal is aborted.
   */
  run: (input: unknown, options?: InferenceOptions) => Promise<TOutput>;

  /**
   * Run streaming inference. Returns a ReadableStream that emits output chunks.
   * @throws {InferisError} if the model is not in 'ready' state.
   */
  stream: (input: unknown, options?: InferenceOptions) => ReadableStream<TOutput>;

  /**
   * Dispose the model and free its memory.
   * Waits for any in-flight inference to complete before unloading.
   */
  dispose: () => Promise<void>;

  /**
   * Subscribe to state changes.
   * @returns unsubscribe function
   */
  onStateChange: (callback: (state: ModelState) => void) => () => void;
}

// ─── Worker Pool ──────────────────────────────────────────────────────────────

export interface WorkerPoolInterface {
  /**
   * Load a model and return a handle for inference.
   * If the model is already loaded (same task + config), returns the existing handle.
   */
  load: <TOutput = unknown>(
    task: string,
    config: ModelLoadConfig,
  ) => Promise<ModelHandle<TOutput>>;

  /**
   * Return snapshot of detected browser capabilities.
   */
  capabilities: () => CapabilityReport;

  /**
   * Gracefully terminate all workers and dispose all models.
   */
  terminate: () => Promise<void>;
}

// ─── Adapter Interfaces ───────────────────────────────────────────────────────

export interface LoadedModel {
  /** Opaque runtime-specific handle (pipeline instance, MLCEngine, etc.). */
  readonly instance: unknown;
  /** Actual memory consumed after loading, in MB. */
  readonly memoryMB: number;
}

/**
 * Adapter interface — implemented INSIDE the worker via the factory pattern.
 * Never instantiated on the main thread.
 */
export interface ModelAdapter {
  readonly name: string;

  /**
   * Load model into memory. Called inside the worker.
   * Must call `onProgress` during download to forward progress to the main thread.
   * @throws on load failure
   */
  load: (
    task: string,
    config: Record<string, unknown>,
    device: Device,
    onProgress: (event: LoadProgressEvent) => void,
  ) => Promise<LoadedModel>;

  /**
   * Run non-streaming inference.
   * Return value must be structured-cloneable.
   */
  run: (model: LoadedModel, input: unknown, options?: unknown) => Promise<unknown>;

  /**
   * Run streaming inference.
   * Call `onChunk` for each output chunk (token, image tile, etc.).
   * onChunk values must be structured-cloneable.
   * Resolve the promise when the stream is complete.
   */
  stream: (
    model: LoadedModel,
    input: unknown,
    onChunk: (chunk: unknown) => void,
    options?: unknown,
  ) => Promise<void>;

  /**
   * Unload model and release all resources.
   * MUST call GPUBuffer.destroy() / GPUDevice.destroy() where applicable.
   */
  unload: (model: LoadedModel) => Promise<void>;

  /**
   * Estimate memory usage before loading. Used by MemoryBudget for pre-eviction.
   */
  estimateMemoryMB: (task: string, config: Record<string, unknown>) => number;
}

/**
 * Factory that creates a ModelAdapter inside the worker.
 * The factory itself is lightweight and runs on the main thread.
 * create() is called inside the worker and does the heavy dynamic import().
 */
export interface ModelAdapterFactory {
  readonly name: string;
  create: () => Promise<ModelAdapter>;
}

// ─── Worker Message Protocol ──────────────────────────────────────────────────

export type MainToWorkerMessage
  = | { readonly type: 'load-model'; readonly reqId: string; readonly modelId: string; readonly task: string; readonly config: Record<string, unknown>; readonly device: Device }
    | { readonly type: 'unload-model'; readonly reqId: string; readonly modelId: string }
    | { readonly type: 'run'; readonly reqId: string; readonly modelId: string; readonly input: unknown; readonly options?: unknown }
    | { readonly type: 'run-stream'; readonly reqId: string; readonly modelId: string; readonly input: unknown; readonly options?: unknown }
    | { readonly type: 'abort'; readonly reqId: string }
    | { readonly type: 'probe'; readonly reqId: string }
    | { readonly type: 'ping' };

export type WorkerToMainMessage
  = | { readonly type: 'load-progress'; readonly reqId: string; readonly progress: LoadProgressEvent }
    | { readonly type: 'load-complete'; readonly reqId: string; readonly memoryMB: number }
    | { readonly type: 'load-error'; readonly reqId: string; readonly error: SerializedError }
    | { readonly type: 'unload-complete'; readonly reqId: string }
    | { readonly type: 'unload-error'; readonly reqId: string; readonly error: SerializedError }
    | { readonly type: 'run-result'; readonly reqId: string; readonly output: unknown }
    | { readonly type: 'run-error'; readonly reqId: string; readonly error: SerializedError }
    | { readonly type: 'stream-chunk'; readonly reqId: string; readonly chunk: unknown }
    | { readonly type: 'stream-end'; readonly reqId: string; readonly usage?: unknown }
    | { readonly type: 'stream-error'; readonly reqId: string; readonly error: SerializedError }
    | { readonly type: 'probe-result'; readonly reqId: string; readonly capabilities: unknown }
    | { readonly type: 'device-lost'; readonly modelId: string; readonly reason: string }
    | { readonly type: 'pong' };

export interface SerializedError {
  readonly name: string;
  readonly message: string;
  readonly code?: string;
  readonly stack?: string | undefined;
}

// ─── Internal Registry Types ──────────────────────────────────────────────────

export interface ModelEntry {
  readonly id: string;
  readonly task: string;
  readonly config: Record<string, unknown>;
  state: ModelState;
  device: Device;
  memoryMB: number;
  workerId: number | null;
  stateListeners: Set<(state: ModelState) => void>;
}

export interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  streamController?: ReadableStreamDefaultController<unknown> | undefined;
  timeoutId?: ReturnType<typeof setTimeout> | undefined;
  signal?: AbortSignal | undefined;
  onAbort?: (() => void) | undefined;
}

// ─── Scheduler Types ──────────────────────────────────────────────────────────

export type TaskPriority = 'high' | 'normal' | 'low';

export interface ScheduledTask {
  readonly reqId: string;
  readonly modelId: string;
  readonly priority: TaskPriority;
  readonly enqueuedAt: number;
  execute: (workerId: number) => void;
  reject: (error: Error) => void;
}
