import type { Device, MainToWorkerMessage, ModelAdapterFactory } from '../core/types.js';
import { serializeError } from '../core/errors.js';
import { WorkerMessageHandler } from './handler.js';

declare const self: DedicatedWorkerGlobalScope;

interface InitMessage {
  type: '__init__';
  device: Device;
}

type AnyMessage = MainToWorkerMessage | InitMessage;

/**
 * Adapter factory registered by the worker entry file.
 * Must be set via `registerAdapterFactory()` before the pool sends `__init__`.
 */
let registeredFactory: ModelAdapterFactory | null = null;

/**
 * Register the adapter factory for this dedicated worker.
 * Call this in your custom worker entry file before any messages arrive.
 *
 * @example
 * ```ts
 * // my-worker.ts
 * import { registerAdapterFactory } from 'inferis/worker-runtime';
 * import { transformersAdapter } from 'inferis/adapters/transformers';
 * registerAdapterFactory(transformersAdapter());
 * ```
 */
export function registerAdapterFactory(factory: ModelAdapterFactory): void {
  registeredFactory = factory;
}

let handler: WorkerMessageHandler | null = null;
let initFailed = false;
const pendingMessages: MainToWorkerMessage[] = [];
let initPromise: Promise<void> | null = null;

async function onInit(device: Device): Promise<void> {
  if (!registeredFactory) {
    initFailed = true;
    console.error('[inferis worker] no adapter factory registered');
    self.postMessage({
      error: {
        code: 'NO_ADAPTER',
        message: 'No adapter factory registered. Call registerAdapterFactory() in your worker entry file.',
        name: 'InferisError',
      },
      reqId: '__init__',
      type: 'load-error',
    });
    return;
  }

  try {
    handler = new WorkerMessageHandler(msg => self.postMessage(msg));
    await handler.init(registeredFactory, device);
  }
  catch (err) {
    initFailed = true;
    handler = null;
    console.error('[inferis worker] init failed:', err);
    self.postMessage({
      error: serializeError(err),
      reqId: '__init__',
      type: 'load-error',
    });
    return;
  }

  for (const msg of pendingMessages.splice(0)) {
    await handler.handle(msg);
  }
}

function postInitError(reqId: string): void {
  self.postMessage({
    error: { code: 'INIT_FAILED', message: 'Worker initialization failed', name: 'InferisError' },
    reqId,
    type: 'load-error',
  });
}

self.onmessage = async (event: MessageEvent<AnyMessage>) => {
  const msg = event.data;

  if (msg.type === '__init__') {
    initPromise = onInit(msg.device);
    return;
  }

  if (msg.type === 'ping') {
    self.postMessage({ type: 'pong' });
    return;
  }

  if (!handler && !initFailed) {
    pendingMessages.push(msg);
    return;
  }

  if (initPromise)
    await initPromise;

  if (initFailed || !handler) {
    if ('reqId' in msg) {
      postInitError(msg.reqId);
    }
    return;
  }

  await handler.handle(msg);
};
