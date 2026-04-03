import type {
  ModelAdapter,
  ModelAdapterFactory,
  WorkerToMainMessage,
} from '../../src/core/types.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkerMessageHandler } from '../../src/worker/handler.js';

function createMockAdapter(name = 'mock'): ModelAdapter {
  return {
    name,
    estimateMemoryMB: vi.fn().mockReturnValue(100),
    load: vi.fn().mockResolvedValue({ instance: { id: 'loaded' }, memoryMB: 64 }),
    run: vi.fn().mockResolvedValue({ output: 'result' }),
    stream: vi.fn().mockResolvedValue(undefined),
    unload: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockFactory(adapter: ModelAdapter): ModelAdapterFactory {
  return {
    name: adapter.name,
    create: vi.fn().mockResolvedValue(adapter),
  };
}

describe('workerMessageHandler', () => {
  let postFn: ReturnType<typeof vi.fn<[WorkerToMainMessage], void>>;
  let handler: WorkerMessageHandler;
  let adapter: ModelAdapter;
  let factory: ModelAdapterFactory;

  beforeEach(() => {
    postFn = vi.fn();
    handler = new WorkerMessageHandler(postFn);
    adapter = createMockAdapter();
    factory = createMockFactory(adapter);
  });

  describe('ping', () => {
    it('posts pong', async () => {
      await handler.handle({ type: 'ping' });
      expect(postFn).toHaveBeenCalledWith({ type: 'pong' });
    });
  });

  describe('load-model', () => {
    it('posts load-error if not initialized', async () => {
      await handler.handle({
        type: 'load-model',
        reqId: 'r1',
        modelId: 'm1',
        task: 'task',
        config: {},
        device: 'wasm',
      });
      expect(postFn).toHaveBeenCalledWith(expect.objectContaining({
        type: 'load-error',
        reqId: 'r1',
      }));
    });

    it('posts load-complete with memoryMB on success', async () => {
      await handler.init(factory, 'wasm');
      await handler.handle({
        type: 'load-model',
        reqId: 'r1',
        modelId: 'm1',
        task: 'feature-extraction',
        config: { model: 'test' },
        device: 'wasm',
      });

      expect(postFn).toHaveBeenCalledWith(expect.objectContaining({
        type: 'load-complete',
        reqId: 'r1',
        memoryMB: 64,
      }));
    });

    it('posts load-progress during download', async () => {
      (adapter.load as ReturnType<typeof vi.fn>).mockImplementation(
        async (_task, _config, _device, onProgress) => {
          onProgress({ loaded: 50, phase: 'model.bin', total: 100 });
          return { instance: {}, memoryMB: 64 };
        },
      );
      await handler.init(factory, 'wasm');
      await handler.handle({
        type: 'load-model',
        reqId: 'r1',
        modelId: 'm1',
        task: 't',
        config: {},
        device: 'wasm',
      });

      expect(postFn).toHaveBeenCalledWith({
        type: 'load-progress',
        reqId: 'r1',
        progress: { loaded: 50, phase: 'model.bin', total: 100 },
      });
    });

    it('posts load-error on adapter failure', async () => {
      (adapter.load as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('download failed'));
      await handler.init(factory, 'wasm');
      await handler.handle({
        type: 'load-model',
        reqId: 'r1',
        modelId: 'm1',
        task: 't',
        config: {},
        device: 'wasm',
      });

      expect(postFn).toHaveBeenCalledWith(expect.objectContaining({
        type: 'load-error',
        reqId: 'r1',
        error: expect.objectContaining({ message: 'download failed' }),
      }));
    });
  });

  describe('run', () => {
    beforeEach(async () => {
      await handler.init(factory, 'wasm');
      await handler.handle({
        type: 'load-model',
        reqId: 'load-r',
        modelId: 'm1',
        task: 't',
        config: {},
        device: 'wasm',
      });
      postFn.mockClear();
    });

    it('posts run-result with exact output', async () => {
      const output = { result: [0.1, 0.9], labels: ['neg', 'pos'] };
      (adapter.run as ReturnType<typeof vi.fn>).mockResolvedValue(output);

      await handler.handle({
        type: 'run',
        reqId: 'r1',
        modelId: 'm1',
        input: 'test input',
        options: { topK: 5 },
      });

      expect(postFn).toHaveBeenCalledWith({
        type: 'run-result',
        reqId: 'r1',
        output,
      });
    });

    it('forwards input and options to adapter.run', async () => {
      const input = { text: 'hello', nested: { data: [1, 2] } };
      const options = { timeout: 5000 };
      await handler.handle({
        type: 'run',
        reqId: 'r1',
        modelId: 'm1',
        input,
        options,
      });

      expect(adapter.run).toHaveBeenCalledWith(
        expect.anything(),
        input,
        options,
      );
    });

    it('posts run-error when adapter.run rejects', async () => {
      (adapter.run as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('inference failed'));

      await handler.handle({
        type: 'run',
        reqId: 'r1',
        modelId: 'm1',
        input: 'x',
      });

      expect(postFn).toHaveBeenCalledWith(expect.objectContaining({
        type: 'run-error',
        reqId: 'r1',
        error: expect.objectContaining({ message: 'inference failed' }),
      }));
    });

    it('does not post run-result after abort', async () => {
      let resolveRun!: (value: unknown) => void;
      (adapter.run as ReturnType<typeof vi.fn>).mockReturnValue(
        new Promise((resolve) => { resolveRun = resolve; }),
      );

      const runPromise = handler.handle({
        type: 'run',
        reqId: 'r1',
        modelId: 'm1',
        input: 'x',
      });

      await handler.handle({ type: 'abort', reqId: 'r1' });
      resolveRun('late result');
      await runPromise;

      const resultMessages = postFn.mock.calls
        .map(c => c[0])
        .filter(m => m.type === 'run-result');
      expect(resultMessages).toHaveLength(0);
    });
  });

  describe('run-stream', () => {
    beforeEach(async () => {
      await handler.init(factory, 'wasm');
      await handler.handle({
        type: 'load-model',
        reqId: 'load-r',
        modelId: 'm1',
        task: 't',
        config: {},
        device: 'wasm',
      });
      postFn.mockClear();
    });

    it('posts stream-chunk for each onChunk and stream-end', async () => {
      (adapter.stream as ReturnType<typeof vi.fn>).mockImplementation(
        async (_model, _input, onChunk) => {
          onChunk('Hello');
          onChunk(' world');
        },
      );

      await handler.handle({
        type: 'run-stream',
        reqId: 'r1',
        modelId: 'm1',
        input: 'x',
      });

      const messages = postFn.mock.calls.map(c => c[0]);
      expect(messages).toContainEqual({ type: 'stream-chunk', reqId: 'r1', chunk: 'Hello' });
      expect(messages).toContainEqual({ type: 'stream-chunk', reqId: 'r1', chunk: ' world' });
      expect(messages).toContainEqual({ type: 'stream-end', reqId: 'r1' });
    });

    it('posts stream-error when adapter.stream rejects', async () => {
      (adapter.stream as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('stream broke'));

      await handler.handle({
        type: 'run-stream',
        reqId: 'r1',
        modelId: 'm1',
        input: 'x',
      });

      expect(postFn).toHaveBeenCalledWith(expect.objectContaining({
        type: 'stream-error',
        reqId: 'r1',
        error: expect.objectContaining({ message: 'stream broke' }),
      }));
    });

    it('does not post chunks after abort', async () => {
      let streamOnChunk!: (chunk: unknown) => void;
      let resolveStream!: () => void;
      (adapter.stream as ReturnType<typeof vi.fn>).mockImplementation(
        (_model, _input, onChunk) => new Promise<void>((resolve) => {
          streamOnChunk = onChunk;
          resolveStream = resolve;
        }),
      );

      const streamPromise = handler.handle({
        type: 'run-stream',
        reqId: 'r1',
        modelId: 'm1',
        input: 'x',
      });

      streamOnChunk('before abort');
      await handler.handle({ type: 'abort', reqId: 'r1' });
      streamOnChunk('after abort');
      resolveStream();
      await streamPromise;

      const chunks = postFn.mock.calls
        .map(c => c[0])
        .filter(m => m.type === 'stream-chunk');
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toEqual({ type: 'stream-chunk', reqId: 'r1', chunk: 'before abort' });
    });
  });

  describe('unload-model', () => {
    beforeEach(async () => {
      await handler.init(factory, 'wasm');
      await handler.handle({
        type: 'load-model',
        reqId: 'load-r',
        modelId: 'm1',
        task: 't',
        config: {},
        device: 'wasm',
      });
      postFn.mockClear();
    });

    it('posts unload-complete on success', async () => {
      await handler.handle({ type: 'unload-model', reqId: 'r1', modelId: 'm1' });
      expect(postFn).toHaveBeenCalledWith({ type: 'unload-complete', reqId: 'r1' });
    });

    it('posts unload-error on failure', async () => {
      (adapter.unload as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('release failed'));

      await handler.handle({ type: 'unload-model', reqId: 'r1', modelId: 'm1' });
      expect(postFn).toHaveBeenCalledWith(expect.objectContaining({
        type: 'unload-error',
        reqId: 'r1',
        error: expect.objectContaining({ message: 'release failed' }),
      }));
    });
  });

  describe('abort', () => {
    it('no-op for unknown reqId', async () => {
      await handler.init(factory, 'wasm');
      await handler.handle({ type: 'abort', reqId: 'nonexistent' });
      expect(postFn).not.toHaveBeenCalled();
    });

    it('rejects pending run with AbortError', async () => {
      await handler.init(factory, 'wasm');
      await handler.handle({
        type: 'load-model',
        reqId: 'load-r',
        modelId: 'm1',
        task: 't',
        config: {},
        device: 'wasm',
      });
      postFn.mockClear();

      let resolveRun!: (value: unknown) => void;
      (adapter.run as ReturnType<typeof vi.fn>).mockReturnValue(
        new Promise((resolve) => { resolveRun = resolve; }),
      );

      const runPromise = handler.handle({
        type: 'run',
        reqId: 'r1',
        modelId: 'm1',
        input: 'x',
      });

      await handler.handle({ type: 'abort', reqId: 'r1' });
      resolveRun('late result');
      await runPromise;

      const errorMessages = postFn.mock.calls
        .map(c => c[0])
        .filter(m => m.type === 'run-error');
      expect(errorMessages).toHaveLength(1);
      expect(errorMessages[0].error.name).toBe('AbortError');
    });
  });
});
