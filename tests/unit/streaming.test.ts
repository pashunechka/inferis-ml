import { describe, expect, it, vi } from 'vitest';
import { ProgressEmitter } from '../../src/streaming/progress-emitter.js';
import { collectStream, collectStreamText, readableToAsyncIter } from '../../src/streaming/token-stream.js';

describe('progressEmitter', () => {
  it('calls subscribed listener on emit', () => {
    const emitter = new ProgressEmitter();
    const cb = vi.fn();
    emitter.on(cb);
    emitter.emit({ loaded: 50, phase: 'download', total: 100 });
    expect(cb).toHaveBeenCalledWith({ loaded: 50, phase: 'download', total: 100 });
  });

  it('unsubscribe removes listener', () => {
    const emitter = new ProgressEmitter();
    const cb = vi.fn();
    const off = emitter.on(cb);
    off();
    emitter.emit({ loaded: 1, phase: 'done', total: 1 });
    expect(cb).not.toHaveBeenCalled();
  });

  it('swallows throwing listeners', () => {
    const emitter = new ProgressEmitter();
    emitter.on(() => {
      throw new Error('boom');
    });
    expect(() => emitter.emit({ loaded: 0, phase: 'x', total: 0 })).not.toThrow();
  });

  it('listenerCount reflects subscriptions', () => {
    const emitter = new ProgressEmitter();
    expect(emitter.listenerCount).toBe(0);
    const off1 = emitter.on(vi.fn());
    const off2 = emitter.on(vi.fn());
    expect(emitter.listenerCount).toBe(2);
    off1();
    expect(emitter.listenerCount).toBe(1);
    off2();
    expect(emitter.listenerCount).toBe(0);
  });

  it('clear removes all listeners', () => {
    const emitter = new ProgressEmitter();
    emitter.on(vi.fn());
    emitter.on(vi.fn());
    emitter.clear();
    expect(emitter.listenerCount).toBe(0);
  });
});

function makeStream<T>(values: T[]): ReadableStream<T> {
  return new ReadableStream<T>({
    start(controller) {
      for (const v of values) controller.enqueue(v);
      controller.close();
    },
  });
}

describe('readableToAsyncIter', () => {
  it('iterates chunks via polyfill path', async () => {
    const stream = makeStream([1, 2, 3]);
    const chunks: number[] = [];
    for await (const chunk of readableToAsyncIter(stream)) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual([1, 2, 3]);
  });

  it('uses native asyncIterator if available', async () => {
    const values = ['a', 'b'];
    const stream = makeStream(values);
    const asyncIterable = {
      async* [Symbol.asyncIterator]() { yield* values; },
    };
    Object.assign(stream, asyncIterable);
    const chunks: string[] = [];
    for await (const chunk of readableToAsyncIter(stream)) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual(['a', 'b']);
  });

  it('return() cancels reader', async () => {
    const stream = makeStream([1, 2, 3]);
    const iter = readableToAsyncIter(stream)[Symbol.asyncIterator]();
    await iter.next();
    await iter.return!();
    const after = await iter.next();
    expect(after.done).toBe(true);
  });

  it('throw() cancels reader and rethrows', async () => {
    let cancelled = false;
    const fakeStream = {
      getReader: () => ({
        cancel: async () => { cancelled = true; },
        read: async () => ({ done: true, value: undefined }),
      }),
    } as unknown as ReadableStream<number>;

    const iter = readableToAsyncIter(fakeStream)[Symbol.asyncIterator]();
    await expect(iter.throw!(new Error('test err'))).rejects.toThrow('test err');
    expect(cancelled).toBe(true);
  });
});

describe('collectStream', () => {
  it('collects all chunks', async () => {
    const stream = makeStream([10, 20, 30]);
    const result = await collectStream(stream);
    expect(result).toEqual([10, 20, 30]);
  });

  it('returns empty array for empty stream', async () => {
    const stream = makeStream<number>([]);
    expect(await collectStream(stream)).toEqual([]);
  });
});

describe('collectStreamText', () => {
  it('joins string chunks', async () => {
    const stream = makeStream(['hello', ' ', 'world']);
    expect(await collectStreamText(stream)).toBe('hello world');
  });

  it('returns empty string for empty stream', async () => {
    const stream = makeStream<string>([]);
    expect(await collectStreamText(stream)).toBe('');
  });
});
