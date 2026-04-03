import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SharedWorkerBridge } from '../../src/coordination/shared-bridge.js';

class MockSharedWorker {
  static instances: MockSharedWorker[] = [];
  onerror: ((e: ErrorEvent) => void) | null = null;
  port: MockMessagePort;

  constructor(public url: string | URL, public options?: WorkerOptions) {
    this.port = new MockMessagePort();
    MockSharedWorker.instances.push(this);
  }
}

class MockMessagePort {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onmessageerror: ((e: MessageEvent) => void) | null = null;
  messages: unknown[] = [];
  transfers: Transferable[][] = [];
  started = false;
  closed = false;

  postMessage(msg: unknown, transfer?: Transferable[]): void {
    this.messages.push(msg);
    if (transfer)
      this.transfers.push(transfer);
  }

  start(): void {
    this.started = true;
  }

  close(): void {
    this.closed = true;
  }

  simulateMessage(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }

  simulateError(data: unknown): void {
    this.onmessageerror?.({ data } as MessageEvent);
  }
}

beforeEach(() => {
  MockSharedWorker.instances = [];
  vi.stubGlobal('SharedWorker', MockSharedWorker);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('sharedWorkerBridge', () => {
  it('creates SharedWorker and starts port', () => {
    const bridge = new SharedWorkerBridge('worker.js');
    expect(bridge).toBeDefined();
    expect(MockSharedWorker.instances).toHaveLength(1);
    expect(MockSharedWorker.instances[0]!.port.started).toBe(true);
  });

  it('postMessage without transfer calls port.postMessage', () => {
    const bridge = new SharedWorkerBridge('worker.js');
    const port = MockSharedWorker.instances[0]!.port;
    bridge.postMessage({ type: 'ping' } as never);
    expect(port.messages).toHaveLength(1);
    expect(port.transfers).toHaveLength(0);
  });

  it('postMessage with transfer passes transferables', () => {
    const bridge = new SharedWorkerBridge('worker.js');
    const port = MockSharedWorker.instances[0]!.port;
    const buf = new ArrayBuffer(8);
    bridge.postMessage({ type: 'ping' } as never, [buf]);
    expect(port.transfers).toHaveLength(1);
    expect(port.transfers[0]).toEqual([buf]);
  });

  it('postMessage with empty transfer array does not pass transferables', () => {
    const bridge = new SharedWorkerBridge('worker.js');
    const port = MockSharedWorker.instances[0]!.port;
    bridge.postMessage({ type: 'ping' } as never, []);
    expect(port.transfers).toHaveLength(0);
  });

  it('on() receives messages from port', () => {
    const bridge = new SharedWorkerBridge('worker.js');
    const port = MockSharedWorker.instances[0]!.port;
    const cb = vi.fn();
    bridge.on(cb);
    port.simulateMessage({ type: 'pong' });
    expect(cb).toHaveBeenCalledWith({ type: 'pong' });
  });

  it('swallows throwing listeners', () => {
    const bridge = new SharedWorkerBridge('worker.js');
    const port = MockSharedWorker.instances[0]!.port;
    bridge.on(() => {
      throw new Error('boom');
    });
    expect(() => port.simulateMessage({ type: 'pong' })).not.toThrow();
  });

  it('unsubscribe removes listener', () => {
    const bridge = new SharedWorkerBridge('worker.js');
    const port = MockSharedWorker.instances[0]!.port;
    const cb = vi.fn();
    const off = bridge.on(cb);
    off();
    port.simulateMessage({ type: 'pong' });
    expect(cb).not.toHaveBeenCalled();
  });

  it('disconnect() closes port and clears listeners', () => {
    const bridge = new SharedWorkerBridge('worker.js');
    const port = MockSharedWorker.instances[0]!.port;
    const cb = vi.fn();
    bridge.on(cb);
    bridge.disconnect();
    expect(port.closed).toBe(true);
    port.simulateMessage({ type: 'pong' });
    expect(cb).not.toHaveBeenCalled();
  });

  it('worker onerror logs to console.error', () => {
    void new SharedWorkerBridge('worker.js');
    const sw = MockSharedWorker.instances[0]!;
    sw.onerror?.({ message: 'worker exploded' } as ErrorEvent);
    expect(console.error).toHaveBeenCalled();
  });

  it('port onmessageerror logs to console.error', () => {
    void new SharedWorkerBridge('worker.js');
    const port = MockSharedWorker.instances[0]!.port;
    port.simulateError({ type: 'deserialization-error' });
    expect(console.error).toHaveBeenCalled();
  });

  it('isSupported returns true when SharedWorker exists', () => {
    expect(SharedWorkerBridge.isSupported()).toBe(true);
  });

  it('isSupported returns false when SharedWorker is absent', () => {
    vi.unstubAllGlobals();
    vi.stubGlobal('SharedWorker', undefined);
    expect(SharedWorkerBridge.isSupported()).toBe(false);
  });
});
