import type { Device, MainToWorkerMessage, ModelAdapterFactory, WorkerToMainMessage } from '../core/types.js';
import { WorkerMessageHandler } from './handler.js';

declare const self: SharedWorkerGlobalScope;

interface InitMessage {
  type: '__init__';
  adapterFactory: ModelAdapterFactory;
  device: Device;
}

type AnyMessage = MainToWorkerMessage | InitMessage;

const portHandlers = new Map<MessagePort, WorkerMessageHandler>();
let sharedAdapterFactory: ModelAdapterFactory | null = null;
let sharedDevice: Device = 'wasm';
let initialized = false;

self.onconnect = (event: MessageEvent) => {
  const port = event.ports[0];
  if (!port)
    return;

  port.start();

  port.onmessage = async (msgEvent: MessageEvent<AnyMessage>) => {
    const msg = msgEvent.data;

    if (msg.type === '__init__') {
      if (!initialized) {
        sharedAdapterFactory = msg.adapterFactory;
        sharedDevice = msg.device;
        initialized = true;
      }

      const handler = new WorkerMessageHandler((response: WorkerToMainMessage) => {
        port.postMessage(response);
      });

      try {
        await handler.init(sharedAdapterFactory!, sharedDevice);
        portHandlers.set(port, handler);
      }
      catch (err) {
        port.postMessage({
          error: { code: 'INIT_FAILED', message: String(err), name: 'InferisError' },
          reqId: '__init__',
          type: 'load-error',
        });
      }
      return;
    }

    const handler = portHandlers.get(port);
    if (!handler) {
      const reqId = (msg as MainToWorkerMessage & { reqId?: string }).reqId ?? '';
      port.postMessage({
        error: { code: 'NOT_INITIALIZED', message: 'Worker not initialized', name: 'InferisError' },
        reqId,
        type: 'load-error',
      });
      return;
    }

    await handler.handle(msg as MainToWorkerMessage);
  };

  port.addEventListener('close', () => {
    portHandlers.delete(port);
  });
};
