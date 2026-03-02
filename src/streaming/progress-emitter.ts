import type { LoadProgressEvent } from '../core/types.js';

type ProgressListener = (event: LoadProgressEvent) => void;

/**
 * Simple progress event emitter for model load operations.
 * Wraps the raw progress callback into a subscribable interface.
 */
export class ProgressEmitter {
  private readonly listeners = new Set<ProgressListener>();

  /**
   * Subscribe to progress events.
   * @returns unsubscribe function
   */
  on(listener: ProgressListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Emit a progress event to all subscribers.
   */
  emit(event: LoadProgressEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      }
      catch {
        // listeners must not throw
      }
    }
  }

  /** Remove all listeners. */
  clear(): void {
    this.listeners.clear();
  }

  /** Number of active listeners. */
  get listenerCount(): number {
    return this.listeners.size;
  }
}
