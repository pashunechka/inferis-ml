import type { ModelEntry, ScheduledTask, TaskPriority } from './types.js';

const PRIORITY_WEIGHT: Record<TaskPriority, number> = {
  high: 2,
  low: 0,
  normal: 1,
};

/**
 * Task scheduler with priority queue and model affinity.
 *
 * Model affinity: when dispatching a task, the scheduler prefers workers
 * that already have the required model loaded, avoiding redundant re-loads.
 */
export class Scheduler {
  private readonly queues: Map<TaskPriority, ScheduledTask[]> = new Map([
    ['high', []],
    ['low', []],
    ['normal', []],
  ]);

  private readonly workerLoad: Map<number, number> = new Map();
  private readonly workerModels: Map<number, Set<string>> = new Map();

  /**
   * Register a worker with the scheduler.
   */
  addWorker(workerId: number): void {
    this.workerLoad.set(workerId, 0);
    this.workerModels.set(workerId, new Set());
  }

  /**
   * Remove a worker from the scheduler.
   * Rejects any queued tasks targeting only this worker (affinity-pinned).
   */
  removeWorker(workerId: number): void {
    this.workerLoad.delete(workerId);
    this.workerModels.delete(workerId);
  }

  /**
   * Notify scheduler that a worker has loaded a model.
   * Used for affinity tracking.
   */
  notifyModelLoaded(workerId: number, modelId: string): void {
    this.workerModels.get(workerId)?.add(modelId);
  }

  /**
   * Notify scheduler that a worker has unloaded a model.
   */
  notifyModelUnloaded(workerId: number, modelId: string): void {
    this.workerModels.get(workerId)?.delete(modelId);
  }

  /**
   * Enqueue a task. It will be dispatched to the best available worker.
   * If all workers are busy, the task waits in the priority queue.
   */
  enqueue(task: ScheduledTask, _models?: ReadonlyMap<string, ModelEntry>): void {
    const workerId = this.pickWorker(task.modelId);
    if (workerId !== null) {
      this.dispatch(task, workerId);
    }
    else {
      this.queues.get(task.priority)!.push(task);
    }
  }

  /**
   * Notify scheduler that a worker has completed a task.
   * Dispatches the next queued task to the now-free worker, if any.
   */
  notifyTaskComplete(workerId: number, _models?: ReadonlyMap<string, ModelEntry>): void {
    const load = this.workerLoad.get(workerId);
    if (load !== undefined) {
      this.workerLoad.set(workerId, Math.max(0, load - 1));
    }
    this.drainNext(workerId);
  }

  /**
   * Attempt to dispatch the highest-priority queued task to a specific worker.
   */
  private drainNext(workerId: number): void {
    for (const priority of ['high', 'normal', 'low'] as TaskPriority[]) {
      const queue = this.queues.get(priority)!;
      if (queue.length === 0)
        continue;

      const idx = this.findAffinityTask(workerId, queue);
      const taskIdx = idx !== -1 ? idx : 0;
      const [task] = queue.splice(taskIdx, 1);
      this.dispatch(task, workerId);
      return;
    }
  }

  /**
   * Pick the best available worker for a given model.
   * Prefers workers with the model already loaded (affinity).
   * Falls back to the least-loaded worker.
   * Returns null if all workers are saturated (load >= concurrencyLimit).
   */
  pickWorker(
    modelId: string,
    concurrencyPerWorker = 4,
  ): number | null {
    let affinityWorker: number | null = null;
    let leastLoadedWorker: number | null = null;
    let leastLoad = Infinity;

    for (const [id, load] of this.workerLoad) {
      if (load >= concurrencyPerWorker)
        continue;

      if (this.workerModels.get(id)?.has(modelId)) {
        if (affinityWorker === null || load < (this.workerLoad.get(affinityWorker) ?? Infinity)) {
          affinityWorker = id;
        }
      }

      if (load < leastLoad) {
        leastLoad = load;
        leastLoadedWorker = id;
      }
    }

    return affinityWorker ?? leastLoadedWorker;
  }

  private dispatch(task: ScheduledTask, workerId: number): void {
    const load = this.workerLoad.get(workerId) ?? 0;
    this.workerLoad.set(workerId, load + 1);
    task.execute(workerId);
  }

  private findAffinityTask(workerId: number, queue: ScheduledTask[]): number {
    const models = this.workerModels.get(workerId);
    if (!models)
      return -1;
    return queue.findIndex(t => models.has(t.modelId));
  }

  /** Return current queue depth across all priorities. */
  get queueDepth(): number {
    let total = 0;
    for (const q of this.queues.values()) total += q.length;
    return total;
  }

  /** Return current load for a worker. */
  workerLoadFor(workerId: number): number {
    return this.workerLoad.get(workerId) ?? 0;
  }

  /** Return all registered worker IDs. */
  get workerIds(): number[] {
    return [...this.workerLoad.keys()];
  }

  /** Clear all worker state (called on pool termination). */
  reset(): void {
    this.workerLoad.clear();
    this.workerModels.clear();
  }

  /** Return the effective priority weight for sorting. */
  static priorityWeight(p: TaskPriority): number {
    return PRIORITY_WEIGHT[p];
  }
}
