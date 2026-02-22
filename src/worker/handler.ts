import type {
  Device,
  MainToWorkerMessage,
  ModelAdapterFactory,
  WorkerToMainMessage,
} from '../core/types.js';
import { serializeError } from '../core/errors.js';
import { ModelHost } from './model-host.js';

type PostFn = (msg: WorkerToMainMessage) => void;

interface AbortEntry {
  reject: (reason: Error) => void;
}

/**
 * Message dispatcher that runs inside a Web Worker.
 * Receives MainToWorkerMessage, dispatches to ModelHost, and posts responses.
 */
export class WorkerMessageHandler {
  private readonly host = new ModelHost();
  private adapterFactory: ModelAdapterFactory | null = null;
  private readonly pending = new Map<string, AbortEntry>();

  constructor(private readonly post: PostFn) {}

  /**
   * Initialize the handler with the adapter factory and resolved device.
   * Must be called once before handling any messages.
   */
  async init(factory: ModelAdapterFactory, _device: Device): Promise<void> {
    this.adapterFactory = factory;
    await this.host.initAdapter(factory);
  }

  /**
   * Handle an incoming message from the main thread.
   */
  async handle(msg: MainToWorkerMessage): Promise<void> {
    switch (msg.type) {
      case 'ping':
        this.post({ type: 'pong' });
        break;
      case 'probe':
        await this.handleProbe(msg.reqId);
        break;
      case 'load-model':
        await this.handleLoad(msg.reqId, msg.modelId, msg.task, msg.config, msg.device);
        break;
      case 'unload-model':
        await this.handleUnload(msg.reqId, msg.modelId);
        break;
      case 'run':
        await this.handleRun(msg.reqId, msg.modelId, msg.input, msg.options);
        break;
      case 'run-stream':
        await this.handleStream(msg.reqId, msg.modelId, msg.input, msg.options);
        break;
      case 'abort':
        this.handleAbort(msg.reqId);
        break;
    }
  }

  private async handleProbe(reqId: string): Promise<void> {
    const { detectCapabilities } = await import('../core/capabilities.js');
    const capabilities = await detectCapabilities();
    this.post({ capabilities, reqId, type: 'probe-result' });
  }

  private async handleLoad(
    reqId: string,
    modelId: string,
    task: string,
    config: Record<string, unknown>,
    device: Device,
  ): Promise<void> {
    if (!this.adapterFactory) {
      this.post({
        error: serializeError(new Error('Worker not initialized')),
        reqId,
        type: 'load-error',
      });
      return;
    }

    try {
      await this.host.initAdapter(this.adapterFactory);
      const model = await this.host.load(modelId, task, config, device, (progress) => {
        this.post({ progress, reqId, type: 'load-progress' });
      });
      this.post({ memoryMB: model.memoryMB, reqId, type: 'load-complete' });
    }
    catch (err) {
      this.post({ error: serializeError(err), reqId, type: 'load-error' });
    }
  }

  private async handleUnload(reqId: string, modelId: string): Promise<void> {
    try {
      await this.host.unload(modelId);
      this.post({ reqId, type: 'unload-complete' });
    }
    catch (err) {
      this.post({ error: serializeError(err), reqId, type: 'unload-error' });
    }
  }

  private async handleRun(
    reqId: string,
    modelId: string,
    input: unknown,
    options: unknown,
  ): Promise<void> {
    try {
      let aborted = false;
      this.pending.set(reqId, {
        reject: (e) => {
          aborted = true;
          this.post({ error: serializeError(e), reqId, type: 'run-error' });
        },
      });

      const output = await this.host.run(modelId, input, options);

      this.pending.delete(reqId);
      if (!aborted) {
        this.post({ output, reqId, type: 'run-result' });
      }
    }
    catch (err) {
      this.pending.delete(reqId);
      this.post({ error: serializeError(err), reqId, type: 'run-error' });
    }
  }

  private async handleStream(
    reqId: string,
    modelId: string,
    input: unknown,
    options: unknown,
  ): Promise<void> {
    let aborted = false;

    this.pending.set(reqId, {
      reject: (e) => {
        aborted = true;
        this.post({ error: serializeError(e), reqId, type: 'stream-error' });
      },
    });

    try {
      await this.host.stream(
        modelId,
        input,
        (chunk) => {
          if (!aborted) {
            this.post({ chunk, reqId, type: 'stream-chunk' });
          }
        },
        options,
      );

      this.pending.delete(reqId);
      if (!aborted) {
        this.post({ reqId, type: 'stream-end' });
      }
    }
    catch (err) {
      this.pending.delete(reqId);
      if (!aborted) {
        this.post({ error: serializeError(err), reqId, type: 'stream-error' });
      }
    }
  }

  private handleAbort(reqId: string): void {
    const entry = this.pending.get(reqId);
    if (!entry)
      return;

    this.pending.delete(reqId);
    const abortError = Object.assign(new Error('AbortError'), { name: 'AbortError' });
    entry.reject(abortError);
  }
}
