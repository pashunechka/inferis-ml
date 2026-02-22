import type { LoadedModel, ModelAdapter, ModelAdapterFactory } from '../core/types.js';

/**
 * Holds loaded model instances inside the worker.
 * A single worker may host multiple models simultaneously.
 */
export class ModelHost {
  private readonly models: Map<string, LoadedModel> = new Map();
  private adapter: ModelAdapter | null = null;

  /**
   * Initialize the adapter. Must be called once before loading models.
   */
  async initAdapter(factory: ModelAdapterFactory): Promise<void> {
    if (this.adapter && this.adapter.name === factory.name)
      return;
    this.adapter = await factory.create();
  }

  /**
   * Check if the adapter has been initialized.
   */
  isReady(): boolean {
    return this.adapter !== null;
  }

  /**
   * Load a model and store it by ID.
   */
  async load(
    modelId: string,
    task: string,
    config: Record<string, unknown>,
    device: 'webgpu' | 'wasm',
    onProgress: (event: { phase: string; loaded: number; total: number }) => void,
  ): Promise<LoadedModel> {
    if (!this.adapter)
      throw new Error('Adapter not initialized');
    if (this.models.has(modelId))
      return this.models.get(modelId)!;

    const loaded = await this.adapter.load(task, config, device, onProgress);
    this.models.set(modelId, loaded);
    return loaded;
  }

  /**
   * Run non-streaming inference on a loaded model.
   */
  async run(modelId: string, input: unknown, options?: unknown): Promise<unknown> {
    if (!this.adapter)
      throw new Error('Adapter not initialized');
    const model = this.getOrThrow(modelId);
    return this.adapter.run(model, input, options);
  }

  /**
   * Run streaming inference. Calls `onChunk` for each output chunk.
   */
  async stream(
    modelId: string,
    input: unknown,
    onChunk: (chunk: unknown) => void,
    options?: unknown,
  ): Promise<void> {
    if (!this.adapter)
      throw new Error('Adapter not initialized');
    const model = this.getOrThrow(modelId);
    return this.adapter.stream(model, input, onChunk, options);
  }

  /**
   * Unload a model and free its resources.
   */
  async unload(modelId: string): Promise<void> {
    const model = this.models.get(modelId);
    if (!model)
      return;

    await this.adapter?.unload(model);
    this.models.delete(modelId);
  }

  /**
   * Check if a model is currently loaded.
   */
  has(modelId: string): boolean {
    return this.models.has(modelId);
  }

  private getOrThrow(modelId: string): LoadedModel {
    const model = this.models.get(modelId);
    if (!model)
      throw new Error(`Model "${modelId}" is not loaded in this worker`);
    return model;
  }

  /** Estimate memory for a model before loading. */
  estimateMemoryMB(task: string, config: Record<string, unknown>): number {
    return this.adapter?.estimateMemoryMB(task, config) ?? 0;
  }
}
