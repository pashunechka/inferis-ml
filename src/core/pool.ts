import type {
  CapabilityReport,
  Device,
  LoadProgressEvent,
  ModelHandle,
  ModelLoadConfig,
  ModelState,
  PendingRequest,
  PoolConfig,
  TaskPriority,
  WorkerToMainMessage,
} from './types.js';
import { MemoryBudget } from './budget.js';
import { detectCapabilities } from './capabilities.js';
import {
  BudgetExceededError,
  EnvironmentError,
  InferisError,
  ModelNotReadyError,
  TaskTimeoutError,
} from './errors.js';
import { canTransition, isAcceptingInference, transition } from './lifecycle.js';
import { ModelRegistry } from './registry.js';
import { Scheduler } from './scheduler.js';

const DEFAULT_MAX_WORKERS = typeof navigator !== 'undefined'
  ? Math.max(1, (navigator.hardwareConcurrency ?? 2) - 1)
  : 1;
const DEFAULT_MAX_MEMORY_MB = 2048;
const DEFAULT_TASK_TIMEOUT_MS = 120_000;

const PRIORITY_ORDER: Record<TaskPriority, number> = { high: 0, low: 2, normal: 1 };

interface InferenceDeferred {
  enqueuedAt: number;
  onAbort: (() => void) | undefined;
  priority: TaskPriority;
  reject: (e: Error) => void;
  resolve: () => void;
  signal: AbortSignal | undefined;
  unsub: (() => void) | undefined;
}

interface WorkerEntry {
  worker: Worker;
  id: number;
}

/**
 * WorkerPool — main orchestrator.
 *
 * Manages a pool of dedicated Web Workers, routes inference tasks,
 * tracks model lifecycle, and enforces memory budgets.
 *
 * @example
 * ```ts
 * const pool = await createPool({ adapter: transformersAdapter() });
 * const model = await pool.load('feature-extraction', { model: 'Xenova/...' });
 * const result = await model.run(['Hello world']);
 * await model.dispose();
 * await pool.terminate();
 * ```
 */
export class WorkerPool {
  private readonly workers: Map<number, WorkerEntry> = new Map();
  private readonly registry: ModelRegistry = new ModelRegistry();
  private readonly scheduler: Scheduler = new Scheduler();
  private readonly budget: MemoryBudget;
  private readonly inferenceWaiters: Map<string, InferenceDeferred[]> = new Map();
  private readonly pending: Map<string, PendingRequest> = new Map();
  private readonly config: Required<PoolConfig>;
  private readonly caps: CapabilityReport;
  private readonly resolvedDevice: Device;
  private nextWorkerId = 0;
  private nextReqId = 0;
  private terminated = false;

  private constructor(config: Required<PoolConfig>, caps: CapabilityReport) {
    this.config = config;
    this.caps = caps;
    this.budget = new MemoryBudget(config.maxMemoryMB);
    this.resolvedDevice = this.resolveDevice(config.defaultDevice, caps);
  }

  /**
   * Create and initialize a WorkerPool.
   * Spawns `maxWorkers` dedicated workers and detects browser capabilities.
   */
  static async create(config: PoolConfig): Promise<WorkerPool> {
    if (typeof Worker === 'undefined') {
      throw new EnvironmentError(
        'inferis requires a browser environment. '
        + 'Wrap initialization in a client-only hook (useEffect, onMounted) or use dynamic import with SSR disabled.',
      );
    }

    const caps = await detectCapabilities();
    const full: Required<PoolConfig> = {
      adapter: config.adapter,
      crossTab: config.crossTab ?? false,
      defaultDevice: config.defaultDevice ?? 'auto',
      maxMemoryMB: config.maxMemoryMB ?? DEFAULT_MAX_MEMORY_MB,
      maxWorkers: config.maxWorkers ?? DEFAULT_MAX_WORKERS,
      taskTimeout: config.taskTimeout ?? DEFAULT_TASK_TIMEOUT_MS,
      workerUrl: config.workerUrl ?? new URL('./worker/dedicated.worker.js', import.meta.url),
    };

    const pool = new WorkerPool(full, caps);
    await pool.spawnWorkers();
    return pool;
  }

  private async spawnWorkers(): Promise<void> {
    for (let i = 0; i < this.config.maxWorkers; i++) {
      await this.spawnWorker();
    }
  }

  private async spawnWorker(): Promise<WorkerEntry> {
    const id = this.nextWorkerId++;
    const worker = new Worker(this.config.workerUrl, { type: 'module' });

    worker.onmessage = (event: MessageEvent<WorkerToMainMessage>) => {
      this.handleWorkerMessage(id, event.data);
    };

    worker.onerror = (event) => {
      console.error(`[inferis] Worker ${id} error:`, event.message);
      this.handleWorkerCrash(id);
    };

    const entry: WorkerEntry = { id, worker };
    this.workers.set(id, entry);
    this.scheduler.addWorker(id);

    worker.postMessage({ device: this.resolvedDevice, type: '__init__' });

    return entry;
  }

  private handleWorkerMessage(workerId: number, msg: WorkerToMainMessage): void {
    switch (msg.type) {
      case 'load-progress': {
        const modelId = this.reqIdToModelId.get(msg.reqId);
        if (modelId) {
          const entry = this.registry.get(modelId);
          if (entry?.config.onProgress) {
            (entry.config.onProgress as (e: LoadProgressEvent) => void)(msg.progress);
          }
        }
        break;
      }
      case 'load-complete': {
        const modelId = this.reqIdToModelId.get(msg.reqId);
        if (modelId) {
          const entry = this.registry.get(modelId);
          if (entry) {
            this.registry.setLoaded(modelId, this.resolvedDevice, msg.memoryMB, workerId);
            this.budget.allocate(modelId, msg.memoryMB);
            this.scheduler.notifyModelLoaded(workerId, modelId);
            this.registry.setState(modelId, transition(entry.state, 'ready'));
          }
          this.reqIdToModelId.delete(msg.reqId);
        }
        const req = this.pending.get(msg.reqId);
        if (req) {
          this.clearPendingTimeout(msg.reqId);
          this.pending.delete(msg.reqId);
          req.resolve(undefined);
        }
        this.scheduler.notifyTaskComplete(workerId);
        break;
      }
      case 'load-error': {
        if (msg.reqId === '__init__') {
          console.error('[inferis] Worker init failed:', msg.error);
          break;
        }
        const modelId = this.reqIdToModelId.get(msg.reqId);
        if (modelId) {
          const entry = this.registry.get(modelId);
          if (entry)
            this.registry.setState(modelId, transition(entry.state, 'error'));
          this.reqIdToModelId.delete(msg.reqId);
        }
        const req = this.pending.get(msg.reqId);
        if (req) {
          this.clearPendingTimeout(msg.reqId);
          this.pending.delete(msg.reqId);
          req.reject(InferisError.fromSerialized(msg.error));
        }
        this.scheduler.notifyTaskComplete(workerId);
        break;
      }
      case 'unload-complete': {
        const modelId = this.reqIdToModelId.get(msg.reqId);
        if (modelId) {
          this.budget.release(modelId);
          this.scheduler.notifyModelUnloaded(workerId, modelId);
          this.registry.setUnloaded(modelId);
          this.registry.setState(modelId, 'disposed');
          this.registry.delete(modelId);
          this.reqIdToModelId.delete(msg.reqId);
        }
        const req = this.pending.get(msg.reqId);
        if (req) {
          this.clearPendingTimeout(msg.reqId);
          this.pending.delete(msg.reqId);
          req.resolve(undefined);
        }
        break;
      }
      case 'unload-error': {
        const modelId = this.reqIdToModelId.get(msg.reqId);
        if (modelId) {
          this.budget.release(modelId);
          this.scheduler.notifyModelUnloaded(workerId, modelId);
          this.registry.setUnloaded(modelId);
          this.registry.setState(modelId, 'error');
          this.registry.delete(modelId);
          this.reqIdToModelId.delete(msg.reqId);
        }
        const req = this.pending.get(msg.reqId);
        if (req) {
          this.clearPendingTimeout(msg.reqId);
          this.pending.delete(msg.reqId);
          req.reject(InferisError.fromSerialized(msg.error));
        }
        break;
      }
      case 'run-result': {
        const req = this.pending.get(msg.reqId);
        if (req) {
          this.clearPendingTimeout(msg.reqId);
          this.pending.delete(msg.reqId);
          req.resolve(msg.output);
        }
        const modelId = this.reqIdToModelId.get(msg.reqId);
        if (modelId) {
          const entry = this.registry.get(modelId);
          if (entry && entry.state === 'inferring') {
            this.registry.setState(modelId, transition(entry.state, 'ready'));
          }
          this.reqIdToModelId.delete(msg.reqId);
        }
        this.scheduler.notifyTaskComplete(workerId);
        if (modelId)
          this.drainInferenceWaiter(modelId);
        break;
      }
      case 'run-error': {
        const req = this.pending.get(msg.reqId);
        if (req) {
          this.clearPendingTimeout(msg.reqId);
          this.pending.delete(msg.reqId);
          req.reject(InferisError.fromSerialized(msg.error));
        }
        const modelId = this.reqIdToModelId.get(msg.reqId);
        if (modelId) {
          const entry = this.registry.get(modelId);
          if (entry && entry.state === 'inferring') {
            this.registry.setState(modelId, transition(entry.state, 'ready'));
          }
          this.reqIdToModelId.delete(msg.reqId);
        }
        this.scheduler.notifyTaskComplete(workerId);
        if (modelId)
          this.drainInferenceWaiter(modelId);
        break;
      }
      case 'stream-chunk': {
        const req = this.pending.get(msg.reqId);
        req?.streamController?.enqueue(msg.chunk);
        break;
      }
      case 'stream-end': {
        const req = this.pending.get(msg.reqId);
        if (req) {
          this.clearPendingTimeout(msg.reqId);
          this.pending.delete(msg.reqId);
          req.streamController?.close();
        }
        const modelId = this.reqIdToModelId.get(msg.reqId);
        if (modelId) {
          const entry = this.registry.get(modelId);
          if (entry && entry.state === 'inferring') {
            this.registry.setState(modelId, transition(entry.state, 'ready'));
          }
          this.reqIdToModelId.delete(msg.reqId);
        }
        this.scheduler.notifyTaskComplete(workerId);
        if (modelId)
          this.drainInferenceWaiter(modelId);
        break;
      }
      case 'stream-error': {
        const req = this.pending.get(msg.reqId);
        if (req) {
          this.clearPendingTimeout(msg.reqId);
          this.pending.delete(msg.reqId);
          req.streamController?.error(InferisError.fromSerialized(msg.error));
        }
        const modelId = this.reqIdToModelId.get(msg.reqId);
        if (modelId) {
          const entry = this.registry.get(modelId);
          if (entry && entry.state === 'inferring') {
            this.registry.setState(modelId, transition(entry.state, 'ready'));
          }
          this.reqIdToModelId.delete(msg.reqId);
        }
        this.scheduler.notifyTaskComplete(workerId);
        if (modelId)
          this.drainInferenceWaiter(modelId);
        break;
      }
      case 'device-lost': {
        const entry = this.registry.get(msg.modelId);
        if (entry && canTransition(entry.state, 'error')) {
          this.registry.setState(msg.modelId, 'error');
        }
        break;
      }
    }
  }

  private readonly reqIdToModelId = new Map<string, string>();

  /**
   * Load a model. If already loaded with the same config, returns existing handle.
   * Performs memory budget check and eviction before loading.
   */
  async load<TOutput = unknown>(
    task: string,
    config: ModelLoadConfig,
  ): Promise<ModelHandle<TOutput>> {
    if (this.terminated)
      throw new InferisError('Pool has been terminated', 'POOL_TERMINATED');

    const modelId = ModelRegistry.makeId(task, config.model);

    // Return existing handle if model is already usable
    const existing = this.registry.get(modelId);
    if (existing) {
      const s = existing.state;
      if (s === 'ready' || s === 'loading' || s === 'inferring') {
        return this.makeHandle<TOutput>(modelId);
      }
    }

    // Estimate memory and check budget
    const adapter = this.config.adapter;
    let estimatedMB = config.estimatedMemoryMB ?? 100;
    if (!config.estimatedMemoryMB) {
      const tempAdapter = await adapter.create().catch(() => null);
      try {
        estimatedMB = tempAdapter?.estimateMemoryMB(task, config as Record<string, unknown>) ?? 100;
      }
      finally {
        await tempAdapter?.unload({ instance: null, memoryMB: 0 }).catch(() => {});
      }
    }

    const toEvict = this.budget.planEviction(estimatedMB);
    if (toEvict === null) {
      throw new BudgetExceededError(estimatedMB, this.config.maxMemoryMB);
    }

    // Evict LRU models to make room
    for (const evictId of toEvict) {
      await this.disposeModel(evictId);
    }

    // Register model entry
    this.registry.register(modelId, task, config as Record<string, unknown>);
    this.registry.setState(modelId, transition('idle', 'loading'));

    // Enqueue load task
    await new Promise<void>((resolve, reject) => {
      const reqId = `${this.nextReqId++}`;
      this.reqIdToModelId.set(reqId, modelId);

      this.pending.set(reqId, { reject, resolve: resolve as (v: unknown) => void });
      this.setRequestTimeout(reqId, this.config.taskTimeout);

      this.scheduler.enqueue(
        {
          enqueuedAt: Date.now(),
          execute: (workerId: number): void => {
            const workerEntry = this.workers.get(workerId);
            if (!workerEntry) {
              reject(new InferisError('Worker not found', 'WORKER_NOT_FOUND'));
              return;
            }
            try {
              const { estimatedMemoryMB: _estMem, onProgress: _onProgress, ...workerConfig } = config;
              workerEntry.worker.postMessage({
                config: workerConfig as Record<string, unknown>,
                device: this.resolvedDevice,
                modelId,
                reqId,
                task,
                type: 'load-model',
              });
            }
            catch {
              this.clearPendingTimeout(reqId);
              this.pending.delete(reqId);
              this.reqIdToModelId.delete(reqId);
              reject(new InferisError('Input cannot be serialized for worker transfer', 'SERIALIZATION_ERROR'));
            }
          },
          modelId,
          priority: 'high',
          reject,
          reqId,
        },
        this.registry.entries,
      );
    });

    return this.makeHandle<TOutput>(modelId);
  }

  private async disposeModel(modelId: string): Promise<void> {
    const entry = this.registry.get(modelId);
    if (!entry || entry.state === 'disposed')
      return;

    if (!canTransition(entry.state, 'unloading'))
      return;

    this.registry.setState(modelId, 'unloading');

    if (entry.workerId === null) {
      this.budget.release(modelId);
      this.registry.delete(modelId);
      return;
    }

    const workerEntry = this.workers.get(entry.workerId);
    if (!workerEntry) {
      this.budget.release(modelId);
      this.registry.delete(modelId);
      return;
    }

    const reqId = `${this.nextReqId++}`;
    this.reqIdToModelId.set(reqId, modelId);

    await new Promise<void>((resolve, reject) => {
      this.pending.set(reqId, { reject, resolve: resolve as (v: unknown) => void });
      this.setRequestTimeout(reqId, 10_000);
      try {
        workerEntry.worker.postMessage({ modelId, reqId, type: 'unload-model' });
      }
      catch {
        this.clearPendingTimeout(reqId);
        this.pending.delete(reqId);
        this.reqIdToModelId.delete(reqId);
        reject(new InferisError('Input cannot be serialized for worker transfer', 'SERIALIZATION_ERROR'));
      }
    });
  }

  private makeHandle<TOutput>(modelId: string): ModelHandle<TOutput> {
    const registry = this.registry;
    const dispose = this.disposeModel.bind(this);
    const runInference = this.runInference.bind(this);
    const streamInference = this.streamInference.bind(this);

    return {
      get device() {
        return registry.get(modelId)?.device ?? 'wasm';
      },
      get id() {
        return modelId;
      },
      get memoryMB() {
        return registry.get(modelId)?.memoryMB ?? 0;
      },
      get state() {
        return registry.get(modelId)?.state ?? 'disposed';
      },

      dispose: () => dispose(modelId),

      onStateChange(callback: (state: ModelState) => void): () => void {
        return registry.subscribe(modelId, callback);
      },

      run(input: unknown, options?) {
        return runInference<TOutput>(modelId, input, options);
      },

      stream(input: unknown, options?) {
        return streamInference<TOutput>(modelId, input, options);
      },
    };
  }

  /**
   * Waits until the model transitions to `ready`, or rejects if it reaches a
   * terminal/non-recoverable state (error, disposed, unloading).
   * Respects the provided AbortSignal.
   *
   * When the model is `inferring`, uses a priority queue so that higher-priority
   * callers are unblocked before lower-priority ones.
   * When the model is `loading`, falls back to a plain state subscription.
   */
  private waitForReady(modelId: string, priority: TaskPriority, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(Object.assign(new Error('AbortError'), { name: 'AbortError' }));
        return;
      }

      const currentState = this.registry.get(modelId)?.state;

      if (currentState === 'loading') {
        const onLoadAbort = (): void => {
          // eslint-disable-next-line ts/no-use-before-define
          unsub();
          reject(Object.assign(new Error('AbortError'), { name: 'AbortError' }));
        };
        const unsub = this.registry.subscribe(modelId, (state) => {
          if (state === 'ready') {
            unsub();
            signal?.removeEventListener('abort', onLoadAbort);
            resolve();
          }
          else if (state !== 'inferring' && state !== 'loading') {
            unsub();
            signal?.removeEventListener('abort', onLoadAbort);
            reject(new ModelNotReadyError(modelId, state));
          }
        });
        signal?.addEventListener('abort', onLoadAbort, { once: true });
        return;
      }

      const deferred: InferenceDeferred = {
        enqueuedAt: Date.now(),
        onAbort: undefined,
        priority,
        reject,
        resolve,
        signal,
        unsub: undefined,
      };

      const queue = this.inferenceWaiters.get(modelId) ?? [];
      queue.push(deferred);
      queue.sort(
        (a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || a.enqueuedAt - b.enqueuedAt,
      );
      this.inferenceWaiters.set(modelId, queue);

      const unsub = this.registry.subscribe(modelId, (state) => {
        if (state !== 'inferring' && state !== 'loading' && state !== 'ready') {
          deferred.unsub = undefined;
          const q = this.inferenceWaiters.get(modelId);
          if (q) {
            const idx = q.indexOf(deferred);
            if (idx >= 0)
              q.splice(idx, 1);
          }
          unsub();
          if (deferred.signal && deferred.onAbort) {
            deferred.signal.removeEventListener('abort', deferred.onAbort);
          }
          reject(new ModelNotReadyError(modelId, state));
        }
      });
      deferred.unsub = unsub;

      if (signal) {
        const onAbort = (): void => {
          const q = this.inferenceWaiters.get(modelId);
          if (q) {
            const idx = q.indexOf(deferred);
            if (idx >= 0)
              q.splice(idx, 1);
          }
          deferred.unsub?.();
          deferred.unsub = undefined;
          reject(Object.assign(new Error('AbortError'), { name: 'AbortError' }));
        };
        deferred.onAbort = onAbort;
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  /**
   * Unblocks the highest-priority waiter queued for the given model.
   * Called after a model transitions back to `ready`.
   */
  private drainInferenceWaiter(modelId: string): void {
    const queue = this.inferenceWaiters.get(modelId);
    if (!queue || queue.length === 0)
      return;

    const [deferred] = queue.splice(0, 1);
    deferred.unsub?.();
    if (deferred.signal && deferred.onAbort) {
      deferred.signal.removeEventListener('abort', deferred.onAbort);
    }
    deferred.resolve();
  }

  private async runInference<TOutput>(
    modelId: string,
    input: unknown,
    options?: { signal?: AbortSignal; priority?: 'high' | 'normal' | 'low' },
  ): Promise<TOutput> {
    if (!this.registry.get(modelId))
      throw new InferisError(`Model "${modelId}" not found`, 'MODEL_NOT_FOUND');

    while (!isAcceptingInference(this.registry.get(modelId)!.state)) {
      const state = this.registry.get(modelId)!.state;
      if (state === 'inferring' || state === 'loading') {
        await this.waitForReady(modelId, options?.priority ?? 'normal', options?.signal);
      }
      else {
        throw new ModelNotReadyError(modelId, state);
      }
    }

    if (options?.signal?.aborted) {
      throw Object.assign(new Error('AbortError'), { name: 'AbortError' });
    }

    const entry = this.registry.get(modelId)!;
    this.registry.setState(modelId, transition(entry.state, 'inferring'));
    this.budget.touch(modelId);

    return new Promise<TOutput>((resolve, reject) => {
      const reqId = `${this.nextReqId++}`;
      this.reqIdToModelId.set(reqId, modelId);

      const onAbort = (): void => {
        const workerEntry = entry.workerId !== null ? this.workers.get(entry.workerId) : undefined;
        workerEntry?.worker.postMessage({ reqId, type: 'abort' });
      };

      options?.signal?.addEventListener('abort', onAbort, { once: true });

      this.pending.set(reqId, {
        onAbort,
        reject: (err) => {
          options?.signal?.removeEventListener('abort', onAbort);
          reject(err);
        },
        resolve: (val) => {
          options?.signal?.removeEventListener('abort', onAbort);
          resolve(val as TOutput);
        },
        signal: options?.signal,
      });

      this.setRequestTimeout(reqId, this.config.taskTimeout);

      this.scheduler.enqueue(
        {
          enqueuedAt: Date.now(),
          execute: (workerId: number): void => {
            const w = this.workers.get(workerId);
            if (!w)
              return;
            try {
              const { priority: _p, signal: _s, ...workerOptions } = options ?? {};
              w.worker.postMessage({ input, modelId, options: workerOptions, reqId, type: 'run' });
            }
            catch {
              this.clearPendingTimeout(reqId);
              this.pending.delete(reqId);
              this.reqIdToModelId.delete(reqId);
              options?.signal?.removeEventListener('abort', onAbort);
              reject(new InferisError('Input cannot be serialized for worker transfer', 'SERIALIZATION_ERROR'));
            }
          },
          modelId,
          priority: options?.priority ?? 'normal',
          reject: (err: Error): void => {
            options?.signal?.removeEventListener('abort', onAbort);
            reject(err);
          },
          reqId,
        },
        this.registry.entries,
      );
    });
  }

  private streamInference<TOutput>(
    modelId: string,
    input: unknown,
    options?: { signal?: AbortSignal; priority?: 'high' | 'normal' | 'low' },
  ): ReadableStream<TOutput> {
    if (!this.registry.get(modelId)) {
      return new ReadableStream({
        start(c) { c.error(new InferisError(`Model "${modelId}" not found`, 'MODEL_NOT_FOUND')); },
      });
    }

    let reqId = '';

    return new ReadableStream<TOutput>({
      start: async (controller) => {
        while (!isAcceptingInference(this.registry.get(modelId)!.state)) {
          const state = this.registry.get(modelId)!.state;
          if (state === 'inferring' || state === 'loading') {
            try {
              await this.waitForReady(modelId, options?.priority ?? 'normal', options?.signal);
            }
            catch (err) {
              controller.error(err);
              return;
            }
          }
          else {
            controller.error(new ModelNotReadyError(modelId, state));
            return;
          }
        }

        const entry = this.registry.get(modelId)!;
        this.registry.setState(modelId, transition(entry.state, 'inferring'));
        this.budget.touch(modelId);

        reqId = `${this.nextReqId++}`;
        this.reqIdToModelId.set(reqId, modelId);

        const onAbort = (): void => {
          const e = this.registry.get(modelId);
          const workerEntry = e?.workerId != null ? this.workers.get(e.workerId) : undefined;
          workerEntry?.worker.postMessage({ reqId, type: 'abort' });
        };

        options?.signal?.addEventListener('abort', onAbort, { once: true });

        this.pending.set(reqId, {
          onAbort,
          reject: (err) => {
            options?.signal?.removeEventListener('abort', onAbort);
            controller.error(err);
          },
          resolve: () => {},
          signal: options?.signal,
          streamController: controller as ReadableStreamDefaultController<unknown>,
        });

        this.setRequestTimeout(reqId, this.config.taskTimeout);

        this.scheduler.enqueue(
          {
            enqueuedAt: Date.now(),
            execute: (workerId: number): void => {
              const w = this.workers.get(workerId);
              if (!w)
                return;
              try {
                const { priority: _p, signal: _s, ...workerOptions } = options ?? {};
                w.worker.postMessage({ input, modelId, options: workerOptions, reqId, type: 'run-stream' });
              }
              catch {
                this.clearPendingTimeout(reqId);
                this.pending.delete(reqId);
                this.reqIdToModelId.delete(reqId);
                options?.signal?.removeEventListener('abort', onAbort);
                controller.error(new InferisError('Input cannot be serialized for worker transfer', 'SERIALIZATION_ERROR'));
              }
            },
            modelId,
            priority: options?.priority ?? 'normal',
            reject: (err: Error): void => {
              options?.signal?.removeEventListener('abort', onAbort);
              controller.error(err);
            },
            reqId,
          },
          this.registry.entries,
        );
      },
      cancel: () => {
        if (!reqId)
          return;
        const e = this.registry.get(modelId);
        const workerEntry = e?.workerId != null ? this.workers.get(e.workerId) : undefined;
        workerEntry?.worker.postMessage({ reqId, type: 'abort' });

        const req = this.pending.get(reqId);
        if (req) {
          if (req.signal && req.onAbort) {
            req.signal.removeEventListener('abort', req.onAbort);
          }
          try {
            req.streamController?.close();
          }
          catch { /* already closed */ }
          this.clearPendingTimeout(reqId);
          this.pending.delete(reqId);
          this.reqIdToModelId.delete(reqId);
        }
      },
    });
  }

  private setRequestTimeout(reqId: string, ms: number): void {
    const id = setTimeout(() => {
      const req = this.pending.get(reqId);
      if (req) {
        if (req.signal && req.onAbort) {
          req.signal.removeEventListener('abort', req.onAbort);
        }
        this.pending.delete(reqId);
        this.reqIdToModelId.delete(reqId);
        req.reject(new TaskTimeoutError(reqId, ms));
      }
    }, ms);

    const req = this.pending.get(reqId);
    if (req)
      req.timeoutId = id;
  }

  private clearPendingTimeout(reqId: string): void {
    const req = this.pending.get(reqId);
    if (req?.timeoutId !== undefined) {
      clearTimeout(req.timeoutId);
    }
  }

  private handleWorkerCrash(workerId: number): void {
    this.scheduler.removeWorker(workerId);
    this.workers.delete(workerId);

    const crashedModelIds = new Set<string>();

    for (const entry of this.registry.byWorker(workerId)) {
      if (canTransition(entry.state, 'error')) {
        this.registry.setState(entry.id, 'error');
      }
      crashedModelIds.add(entry.id);
    }

    for (const [reqId, req] of this.pending) {
      const modelId = this.reqIdToModelId.get(reqId);
      if (modelId && crashedModelIds.has(modelId)) {
        this.clearPendingTimeout(reqId);
        if (req.signal && req.onAbort) {
          req.signal.removeEventListener('abort', req.onAbort);
        }
        this.pending.delete(reqId);
        this.reqIdToModelId.delete(reqId);
        req.reject(new InferisError('Worker crashed', 'WORKER_CRASHED'));
      }
    }
  }

  /**
   * Gracefully terminate all workers and dispose all models.
   */
  async terminate(): Promise<void> {
    this.terminated = true;

    // Reject all pending requests
    for (const [reqId, req] of this.pending) {
      clearTimeout(req.timeoutId);
      req.reject(new InferisError('Pool terminated', 'POOL_TERMINATED'));
      this.pending.delete(reqId);
      this.reqIdToModelId.delete(reqId);
    }

    for (const entry of this.workers.values()) {
      entry.worker.terminate();
    }

    this.workers.clear();
    this.scheduler.reset();
  }

  /**
   * Return snapshot of detected browser capabilities.
   */
  capabilities(): CapabilityReport {
    return this.caps;
  }

  private resolveDevice(defaultDevice: Device | 'auto', caps: CapabilityReport): Device {
    if (defaultDevice === 'auto') {
      return caps.webgpu.supported && !caps.webgpu.isFallback ? 'webgpu' : 'wasm';
    }
    return defaultDevice;
  }

  /** @internal */
  get _registry(): ModelRegistry { return this.registry; }
  /** @internal */
  get _budget(): MemoryBudget { return this.budget; }
  /** @internal */
  get _scheduler(): Scheduler { return this.scheduler; }
}

/**
 * Create and initialize a WorkerPool.
 *
 * @example
 * ```ts
 * import { createPool } from 'inferis-ml';
 * import { transformersAdapter } from 'inferis-ml/adapters/transformers';
 *
 * const pool = await createPool({ adapter: transformersAdapter() });
 * ```
 */
export async function createPool(config: PoolConfig): Promise<WorkerPool> {
  return WorkerPool.create(config);
}
