import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TabChannel } from '../../src/coordination/tab-channel.js';

class MockBroadcastChannel {
  static instances: MockBroadcastChannel[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  posted: unknown[] = [];
  closed = false;

  constructor(public name: string) {
    MockBroadcastChannel.instances.push(this);
  }

  postMessage(data: unknown): void {
    this.posted.push(data);
  }

  close(): void {
    this.closed = true;
  }

  simulateMessage(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }
}

beforeEach(() => {
  MockBroadcastChannel.instances = [];
  vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('tabChannel', () => {
  it('creates a BroadcastChannel on construction', () => {
    void new TabChannel();
    expect(MockBroadcastChannel.instances.length).toBe(1);
    expect(MockBroadcastChannel.instances[0]!.name).toBe('inferis:bus');
  });

  it('send() calls postMessage on the channel', () => {
    const ch = new TabChannel();
    const bc = MockBroadcastChannel.instances[0]!;
    ch.send({ tabId: 't1', type: 'leader-elected' });
    expect(bc.posted).toHaveLength(1);
    expect(bc.posted[0]).toEqual({ tabId: 't1', type: 'leader-elected' });
  });

  it('on() receives valid messages', () => {
    const ch = new TabChannel();
    const bc = MockBroadcastChannel.instances[0]!;
    const cb = vi.fn();
    ch.on(cb);
    bc.simulateMessage({ tabId: 't1', type: 'leader-elected' });
    expect(cb).toHaveBeenCalledWith({ tabId: 't1', type: 'leader-elected' });
  });

  it('on() filters invalid message types', () => {
    const ch = new TabChannel();
    const bc = MockBroadcastChannel.instances[0]!;
    const cb = vi.fn();
    ch.on(cb);
    bc.simulateMessage({ type: 'unknown-type' });
    expect(cb).not.toHaveBeenCalled();
  });

  it('on() filters null data', () => {
    const ch = new TabChannel();
    const bc = MockBroadcastChannel.instances[0]!;
    const cb = vi.fn();
    ch.on(cb);
    bc.simulateMessage(null);
    expect(cb).not.toHaveBeenCalled();
  });

  it('on() filters non-object data', () => {
    const ch = new TabChannel();
    const bc = MockBroadcastChannel.instances[0]!;
    const cb = vi.fn();
    ch.on(cb);
    bc.simulateMessage('string-message');
    expect(cb).not.toHaveBeenCalled();
  });

  it('on() filters object without type', () => {
    const ch = new TabChannel();
    const bc = MockBroadcastChannel.instances[0]!;
    const cb = vi.fn();
    ch.on(cb);
    bc.simulateMessage({ reqId: 'x' });
    expect(cb).not.toHaveBeenCalled();
  });

  it('unsubscribe removes listener', () => {
    const ch = new TabChannel();
    const bc = MockBroadcastChannel.instances[0]!;
    const cb = vi.fn();
    const off = ch.on(cb);
    off();
    bc.simulateMessage({ tabId: 't1', type: 'leader-elected' });
    expect(cb).not.toHaveBeenCalled();
  });

  it('swallows throwing listeners', () => {
    const ch = new TabChannel();
    const bc = MockBroadcastChannel.instances[0]!;
    ch.on(() => {
      throw new Error('boom');
    });
    expect(() => bc.simulateMessage({ tabId: 't1', type: 'leader-elected' })).not.toThrow();
  });

  it('close() closes the BroadcastChannel', () => {
    const ch = new TabChannel();
    const bc = MockBroadcastChannel.instances[0]!;
    ch.close();
    expect(bc.closed).toBe(true);
  });

  it('close() removes all listeners', () => {
    const ch = new TabChannel();
    const bc = MockBroadcastChannel.instances[0]!;
    const cb = vi.fn();
    ch.on(cb);
    ch.close();
    bc.simulateMessage({ tabId: 't1', type: 'leader-elected' });
    expect(cb).not.toHaveBeenCalled();
  });

  it('all known message types pass validation', () => {
    const ch = new TabChannel();
    const bc = MockBroadcastChannel.instances[0]!;
    const cb = vi.fn();
    ch.on(cb);

    const messages = [
      { tabId: 't1', type: 'leader-elected' },
      { tabId: 't1', type: 'leader-gone' },
      { payload: {}, reqId: 'r1', tabId: 't1', type: 'request' },
      { payload: {}, reqId: 'r1', type: 'response' },
      { chunk: 'a', reqId: 'r1', type: 'stream-chunk' },
      { reqId: 'r1', type: 'stream-end' },
      { error: { message: 'err', name: 'Error' }, reqId: 'r1', type: 'stream-error' },
    ];

    for (const msg of messages) {
      bc.simulateMessage(msg);
    }
    expect(cb).toHaveBeenCalledTimes(messages.length);
  });

  it('isSupported returns true when BroadcastChannel exists', () => {
    expect(TabChannel.isSupported()).toBe(true);
  });

  it('isSupported returns false when BroadcastChannel is absent', () => {
    vi.unstubAllGlobals();
    vi.stubGlobal('BroadcastChannel', undefined);
    expect(TabChannel.isSupported()).toBe(false);
  });
});
