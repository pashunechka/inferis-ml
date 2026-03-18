import type { MainToWorkerMessage, WorkerToMainMessage } from '../core/types.js';

type MessageListener = (msg: WorkerToMainMessage) => void;

/**
 * Bridge to a SharedWorker.
 *
 * @remarks
 * SharedWorker allows all tabs from the same origin to share one worker process.
 * One worker holds all model instances, eliminating per-tab model duplication.
 *
 * Tier 1 coordination (~58% browser coverage):
 * - Chrome 4+, Edge 79+, Firefox 29+, Safari 16+
 * - NOT supported on iOS Safari < 16 or Android Chrome
 *
 * If SharedWorker is unavailable, fall back to LeaderElection (tier 2)
 * or per-tab dedicated workers (tier 3).
 */
export class SharedWorkerBridge {
  private readonly port: MessagePort;
  private readonly listeners = new Set<MessageListener>();

  constructor(workerUrl: URL | string) {
    const sw = new SharedWorker(workerUrl, { type: 'module' });
    this.port = sw.port;

    sw.onerror = (event: ErrorEvent) => {
      console.error('[SharedWorkerBridge] worker error:', event.message);
    };

    this.port.onmessage = (event: MessageEvent<WorkerToMainMessage>) => {
      for (const listener of this.listeners) {
        try {
          listener(event.data);
        }
        catch {
          // listeners must not throw
        }
      }
    };

    this.port.onmessageerror = (event: MessageEvent) => {
      console.error('[SharedWorkerBridge] port deserialization error:', event);
    };

    this.port.start();
  }

  /**
   * Send a message to the shared worker.
   */
  postMessage(msg: MainToWorkerMessage, transfer?: Transferable[]): void {
    if (transfer?.length) {
      this.port.postMessage(msg, transfer);
    }
    else {
      this.port.postMessage(msg);
    }
  }

  /**
   * Subscribe to incoming messages from the shared worker.
   * @returns unsubscribe function
   */
  on(listener: MessageListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Disconnect from the shared worker. The worker itself stays alive
   * as long as other tabs are connected.
   */
  disconnect(): void {
    this.listeners.clear();
    this.port.close();
  }

  /**
   * Check if SharedWorker is available in the current environment.
   */
  static isSupported(): boolean {
    return typeof SharedWorker !== 'undefined';
  }
}
