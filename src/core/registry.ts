import type { Device, ModelEntry, ModelState } from './types.js';

/**
 * ModelRegistry tracks all model entries across workers.
 *
 * A model ID is composed of `task:modelName` to allow the same underlying
 * model to be used for different tasks without collision.
 */
export class ModelRegistry {
  private readonly models: Map<string, ModelEntry> = new Map();

  /**
   * Compose a canonical model ID from task and config.
   */
  static makeId(task: string, modelName: string): string {
    return `${task}:${modelName}`;
  }

  /**
   * Register a new model entry with IDLE state.
   */
  register(id: string, task: string, config: Record<string, unknown>): ModelEntry {
    if (this.models.has(id)) {
      return this.models.get(id)!;
    }

    const entry: ModelEntry = {
      config,
      device: 'wasm',
      id,
      memoryMB: 0,
      state: 'idle',
      stateListeners: new Set(),
      task,
      workerId: null,
    };
    this.models.set(id, entry);
    return entry;
  }

  /**
   * Get a model entry by ID.
   */
  get(id: string): ModelEntry | undefined {
    return this.models.get(id);
  }

  /**
   * Check if a model entry exists.
   */
  has(id: string): boolean {
    return this.models.has(id);
  }

  /**
   * Update the state of a model entry, notifying all subscribers.
   */
  setState(id: string, state: ModelState): void {
    const entry = this.models.get(id);
    if (!entry)
      return;

    entry.state = state;
    for (const listener of entry.stateListeners) {
      try {
        listener(state);
      }
      catch {
        // listeners must not throw
      }
    }
  }

  /**
   * Update the device, memory, and worker assignment after a successful load.
   */
  setLoaded(id: string, device: Device, memoryMB: number, workerId: number): void {
    const entry = this.models.get(id);
    if (!entry)
      return;

    entry.device = device;
    entry.memoryMB = memoryMB;
    entry.workerId = workerId;
  }

  /**
   * Clear the worker assignment on unload.
   */
  setUnloaded(id: string): void {
    const entry = this.models.get(id);
    if (!entry)
      return;

    entry.workerId = null;
    entry.memoryMB = 0;
  }

  /**
   * Add a state change listener to a model entry.
   * @returns unsubscribe function
   */
  subscribe(id: string, listener: (state: ModelState) => void): () => void {
    const entry = this.models.get(id);
    if (!entry)
      return () => {};

    entry.stateListeners.add(listener);
    return () => entry.stateListeners.delete(listener);
  }

  /**
   * Remove a model entry completely.
   */
  delete(id: string): void {
    const entry = this.models.get(id);
    if (entry) {
      entry.stateListeners.clear();
      this.models.delete(id);
    }
  }

  /**
   * Return all model entries in a given state.
   */
  byState(state: ModelState): ModelEntry[] {
    return [...this.models.values()].filter(e => e.state === state);
  }

  /**
   * Return all model entries assigned to a specific worker.
   */
  byWorker(workerId: number): ModelEntry[] {
    return [...this.models.values()].filter(e => e.workerId === workerId);
  }

  /** Number of registered model entries. */
  get size(): number {
    return this.models.size;
  }

  /** All model entries (read-only view for scheduling). */
  get entries(): ReadonlyMap<string, ModelEntry> {
    return this.models;
  }
}
