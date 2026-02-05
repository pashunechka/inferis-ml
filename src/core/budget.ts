/**
 * LRU-based memory budget tracker.
 *
 * Tracks approximate memory usage across loaded models.
 * When a new model load would exceed the configured budget,
 * evicts least-recently-used models to make room.
 */
export class MemoryBudget {
  private readonly maxMB: number;
  private usedMB: number = 0;
  private readonly lruOrder: string[] = [];
  private readonly modelSizes: Map<string, number> = new Map();

  constructor(maxMB: number) {
    if (maxMB <= 0)
      throw new RangeError('maxMB must be > 0');
    this.maxMB = maxMB;
  }

  /** Total memory budget in MB. */
  get totalMB(): number {
    return this.maxMB;
  }

  /** Currently allocated memory in MB. */
  get allocatedMB(): number {
    return this.usedMB;
  }

  /** Remaining available memory in MB. */
  get availableMB(): number {
    return this.maxMB - this.usedMB;
  }

  /**
   * Determine which model IDs must be evicted to fit `requiredMB`.
   * Does NOT perform the eviction itself — caller is responsible for
   * actually unloading the returned models before calling `allocate()`.
   *
   * @returns Array of model IDs to evict (LRU order), or null if
   *          `requiredMB` exceeds the total budget (impossible to fit).
   */
  planEviction(requiredMB: number): string[] | null {
    if (requiredMB > this.maxMB)
      return null;
    if (requiredMB <= this.availableMB)
      return [];

    const toEvict: string[] = [];
    let freed = 0;

    for (const id of this.lruOrder) {
      if (freed >= requiredMB - this.availableMB)
        break;
      const size = this.modelSizes.get(id);
      if (size !== undefined) {
        toEvict.push(id);
        freed += size;
      }
    }

    return freed >= requiredMB - this.availableMB ? toEvict : null;
  }

  /**
   * Allocate memory for a model. Call after the model is loaded.
   * Updates LRU order.
   */
  allocate(modelId: string, memoryMB: number): void {
    if (this.modelSizes.has(modelId)) {
      this.release(modelId);
    }
    this.modelSizes.set(modelId, memoryMB);
    this.usedMB += memoryMB;
    this.touch(modelId);
  }

  /**
   * Release memory for a model. Call when model is unloaded.
   */
  release(modelId: string): void {
    const size = this.modelSizes.get(modelId);
    if (size === undefined)
      return;

    this.modelSizes.delete(modelId);
    this.usedMB = Math.max(0, this.usedMB - size);

    const idx = this.lruOrder.indexOf(modelId);
    if (idx !== -1)
      this.lruOrder.splice(idx, 1);
  }

  /**
   * Mark a model as recently used, moving it to the back of the LRU queue.
   */
  touch(modelId: string): void {
    const idx = this.lruOrder.indexOf(modelId);
    if (idx !== -1)
      this.lruOrder.splice(idx, 1);
    this.lruOrder.push(modelId);
  }

  /**
   * Check whether allocating `requiredMB` would stay within budget
   * (i.e., requires no evictions).
   */
  fits(requiredMB: number): boolean {
    return requiredMB <= this.availableMB;
  }

  /** Return LRU-ordered list of tracked model IDs (oldest first). */
  get lruList(): readonly string[] {
    return this.lruOrder;
  }
}
