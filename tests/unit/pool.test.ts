import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detectCapabilities } from '../../src/core/capabilities.js';
import { EnvironmentError } from '../../src/core/errors.js';

import { WorkerPool } from '../../src/core/pool.js';

vi.mock('../../src/core/capabilities.js', () => ({
  clearCapabilitiesCache: vi.fn(),
  detectCapabilities: vi.fn(),
}));

const mockCapsWasm = {
  broadcastChannel: false,
  hardwareConcurrency: 2,
  sharedWorker: false,
  wasm: { simd: true, supported: true, threads: false },
  webgpu: { adapter: null, isFallback: false, limits: null, supported: false },
  webLocks: false,
};

const mockCapsWebGpu = {
  ...mockCapsWasm,
  webgpu: {
    adapter: { architecture: '', description: '', device: '', vendor: 'nvidia' },
    isFallback: false,
    limits: { maxBufferSize: 1000, maxStorageBufferBindingSize: 500 },
    supported: true,
  },
};

class MockWorker {
  static instances: MockWorker[] = [];
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  messages: unknown[] = [];
  terminated = false;

  constructor(public url: string | URL, public options?: WorkerOptions) {
    MockWorker.instances.push(this);
  }

  postMessage(msg: unknown): void {
    this.messages.push(msg);
  }

  terminate(): void {
    this.terminated = true;
  }

  sim(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }

  simError(message: string): void {
    this.onerror?.({ message } as ErrorEvent);
  }

  findMsg(type: string): ({ reqId: string } & Record<string, unknown>) | undefined {
    return this.messages.find(m => (m as { type: string }).type === type) as ({ reqId: string } & Record<string, unknown>) | undefined;
  }
}

function makeAdapter() {
  return {
    create: vi.fn().mockResolvedValue({
      estimateMemoryMB: vi.fn().mockReturnValue(100),
      load: vi.fn(),
      name: 'mock',
      run: vi.fn(),
      stream: vi.fn(),
      unload: vi.fn().mockResolvedValue(undefined),
    }),
    name: 'mock',
  };
}

async function createPool(overrides: Record<string, unknown> = {}) {
  return WorkerPool.create({
    adapter: makeAdapter(),
    maxMemoryMB: 2048,
    maxWorkers: 1,
    taskTimeout: 5000,
    workerUrl: 'worker.js',
    ...overrides,
  });
}

async function waitForMsg(w: MockWorker, type: string) {
  await vi.waitFor(() => {
    const msg = w.findMsg(type);
    if (!msg)
      throw new Error(`no ${type} message`);
  });
  return w.findMsg(type)!;
}

async function loadModel(pool: WorkerPool, modelName = 'my-model', memoryMB = 128) {
  const w = MockWorker.instances[MockWorker.instances.length - 1]!;
  const p = pool.load('text', { estimatedMemoryMB: 50, model: modelName });
  const loadMsg = await waitForMsg(w, 'load-model');
  w.sim({ memoryMB, reqId: loadMsg.reqId, type: 'load-complete' });
  return p;
}

beforeEach(() => {
  MockWorker.instances = [];
  vi.mocked(detectCapabilities).mockResolvedValue(mockCapsWasm as never);
  vi.stubGlobal('Worker', MockWorker);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('sSR guard', () => {
  it('throws EnvironmentError when Worker is undefined', async () => {
    vi.unstubAllGlobals();
    await expect(
      WorkerPool.create({ adapter: { type: 'custom', factory: {} as never } }),
    ).rejects.toThrow(EnvironmentError);
  });
});

describe('workerPool.create', () => {
  it('spawns configured number of workers', async () => {
    await createPool({ maxWorkers: 2 });
    expect(MockWorker.instances).toHaveLength(2);
  });

  it('sends __init__ to each worker', async () => {
    await createPool();
    const initMsg = MockWorker.instances[0]!.messages[0] as { type: string };
    expect(initMsg.type).toBe('__init__');
  });

  it('resolves device to wasm when webgpu is unsupported', async () => {
    await createPool();
    const initMsg = MockWorker.instances[0]!.messages[0] as { device: string };
    expect(initMsg.device).toBe('wasm');
  });

  it('resolves device to webgpu when webgpu is supported and not fallback', async () => {
    vi.mocked(detectCapabilities).mockResolvedValue(mockCapsWebGpu as never);
    await createPool();
    const initMsg = MockWorker.instances[0]!.messages[0] as { device: string };
    expect(initMsg.device).toBe('webgpu');
  });

  it('respects explicit defaultDevice=wasm even when webgpu is available', async () => {
    vi.mocked(detectCapabilities).mockResolvedValue(mockCapsWebGpu as never);
    await createPool({ defaultDevice: 'wasm' });
    const initMsg = MockWorker.instances[0]!.messages[0] as { device: string };
    expect(initMsg.device).toBe('wasm');
  });

  it('respects explicit defaultDevice=webgpu even without webgpu caps', async () => {
    await createPool({ defaultDevice: 'webgpu' });
    const initMsg = MockWorker.instances[0]!.messages[0] as { device: string };
    expect(initMsg.device).toBe('webgpu');
  });
});

describe('workerPool.capabilities()', () => {
  it('returns detected caps', async () => {
    const pool = await createPool();
    expect(pool.capabilities()).toBe(mockCapsWasm);
  });
});

describe('workerPool.terminate()', () => {
  it('terminates all workers', async () => {
    const pool = await createPool({ maxWorkers: 2 });
    await pool.terminate();
    for (const w of MockWorker.instances) {
      expect(w.terminated).toBe(true);
    }
  });

  it('rejects pending requests on terminate', async () => {
    const pool = await createPool();
    const w = MockWorker.instances[0]!;
    const p = pool.load('text', { estimatedMemoryMB: 50, model: 'model' });
    await waitForMsg(w, 'load-model');
    await pool.terminate();
    await expect(p).rejects.toThrow('Pool terminated');
  });
});

describe('load()', () => {
  it('throws when pool is terminated', async () => {
    const pool = await createPool();
    await pool.terminate();
    await expect(pool.load('text', { model: 'm' })).rejects.toThrow('Pool has been terminated');
  });

  it('resolves handle when load-complete is received', async () => {
    const pool = await createPool();
    const handle = await loadModel(pool);
    expect(handle.id).toBe('text:my-model');
    expect(handle.state).toBe('ready');
  });

  it('rejects when load-error is received', async () => {
    const pool = await createPool();
    const w = MockWorker.instances[0]!;
    const p = pool.load('text', { estimatedMemoryMB: 50, model: 'my-model' });
    const loadMsg = await waitForMsg(w, 'load-model');
    w.sim({ error: { code: 'MODEL_LOAD_ERROR', message: 'failed', name: 'InferisError' }, reqId: loadMsg.reqId, type: 'load-error' });
    await expect(p).rejects.toThrow('failed');
  });

  it('returns same handle for already-loaded model', async () => {
    const pool = await createPool();
    const h1 = await loadModel(pool);
    const h2 = await pool.load('text', { estimatedMemoryMB: 50, model: 'my-model' });
    expect(h2.id).toBe(h1.id);
  });

  it('throws BudgetExceededError when memory is insufficient', async () => {
    const pool = await createPool({ maxMemoryMB: 10 });
    await expect(pool.load('text', { estimatedMemoryMB: 500, model: 'm' })).rejects.toThrow('Cannot load model');
  });

  it('calls onProgress when load-progress is received', async () => {
    const pool = await createPool();
    const w = MockWorker.instances[0]!;
    const onProgress = vi.fn();
    const p = pool.load('text', { estimatedMemoryMB: 50, model: 'my-model', onProgress });
    const loadMsg = await waitForMsg(w, 'load-model');
    w.sim({ progress: { loaded: 50, phase: 'downloading', total: 100 }, reqId: loadMsg.reqId, type: 'load-progress' });
    w.sim({ memoryMB: 100, reqId: loadMsg.reqId, type: 'load-complete' });
    await p;
    expect(onProgress).toHaveBeenCalledWith({ loaded: 50, phase: 'downloading', total: 100 });
  });
});

describe('model handle', () => {
  it('handle.state reflects registry', async () => {
    const pool = await createPool();
    const handle = await loadModel(pool);
    expect(handle.state).toBe('ready');
  });

  it('handle.memoryMB reflects loaded value', async () => {
    const pool = await createPool();
    const handle = await loadModel(pool);
    expect(handle.memoryMB).toBe(128);
  });

  it('handle.device reflects resolved device', async () => {
    const pool = await createPool();
    const handle = await loadModel(pool);
    expect(handle.device).toBe('wasm');
  });

  it('handle.onStateChange receives updates', async () => {
    const pool = await createPool();
    const handle = await loadModel(pool);
    const cb = vi.fn();
    handle.onStateChange(cb);
    pool.registry.setState('text:my-model', 'inferring');
    expect(cb).toHaveBeenCalledWith('inferring');
  });

  describe('handle.run()', () => {
    it('resolves with run-result', async () => {
      const pool = await createPool();
      const handle = await loadModel(pool);
      const w = MockWorker.instances[0]!;

      const runPromise = handle.run('hello');
      const runMsg = await waitForMsg(w, 'run');
      w.sim({ output: 'result', reqId: runMsg.reqId, type: 'run-result' });
      expect(await runPromise).toBe('result');
    });

    it('rejects on run-error', async () => {
      const pool = await createPool();
      const handle = await loadModel(pool);
      const w = MockWorker.instances[0]!;

      const runPromise = handle.run('hello');
      const runMsg = await waitForMsg(w, 'run');
      w.sim({ error: { code: 'INFERENCE_ERROR', message: 'fail', name: 'InferisError' }, reqId: runMsg.reqId, type: 'run-error' });
      await expect(runPromise).rejects.toThrow('fail');
    });

    it('throws ModelNotReadyError when model is not ready', async () => {
      const pool = await createPool();
      const handle = await loadModel(pool);
      pool.registry.setState('text:my-model', 'error');
      await expect(handle.run('x')).rejects.toThrow('not ready');
    });

    it('throws AbortError when signal already aborted', async () => {
      const pool = await createPool();
      const handle = await loadModel(pool);
      const controller = new AbortController();
      controller.abort();
      await expect(handle.run('x', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('sends abort message on signal abort', async () => {
      const pool = await createPool();
      const handle = await loadModel(pool);
      const w = MockWorker.instances[0]!;
      const controller = new AbortController();

      const runPromise = handle.run('x', { signal: controller.signal });
      const runMsg = await waitForMsg(w, 'run');
      controller.abort();

      const abortMsg = await waitForMsg(w, 'abort');
      expect(abortMsg).toBeDefined();

      w.sim({ error: { code: 'ABORT', message: 'AbortError', name: 'AbortError' }, reqId: runMsg.reqId, type: 'run-error' });
      await runPromise.catch(() => {});
    });

    it('run with high priority enqueues with that priority', async () => {
      const pool = await createPool();
      const handle = await loadModel(pool);
      const w = MockWorker.instances[0]!;

      const runPromise = handle.run('x', { priority: 'high' });
      const runMsg = await waitForMsg(w, 'run');
      w.sim({ output: 'ok', reqId: runMsg.reqId, type: 'run-result' });
      await runPromise;
    });

    it('forwards exact input into worker message', async () => {
      const pool = await createPool();
      const handle = await loadModel(pool);
      const w = MockWorker.instances[0]!;

      const complexInput = { nested: { arr: [1, 2, 3] }, text: 'hello' };
      const runPromise = handle.run(complexInput);
      const runMsg = await waitForMsg(w, 'run');
      expect(runMsg.input).toEqual(complexInput);
      w.sim({ output: 'ok', reqId: runMsg.reqId, type: 'run-result' });
      await runPromise;
    });

    it('forwards options without priority and signal into worker message', async () => {
      const pool = await createPool();
      const handle = await loadModel(pool);
      const w = MockWorker.instances[0]!;
      const controller = new AbortController();

      const runPromise = handle.run('x', { priority: 'high', signal: controller.signal });
      const runMsg = await waitForMsg(w, 'run');
      expect(runMsg.options).toEqual({});
      expect(runMsg.options).not.toHaveProperty('priority');
      expect(runMsg.options).not.toHaveProperty('signal');
      w.sim({ output: 'ok', reqId: runMsg.reqId, type: 'run-result' });
      await runPromise;
    });

    it('resolves with complex object output unchanged', async () => {
      const pool = await createPool();
      const handle = await loadModel(pool);
      const w = MockWorker.instances[0]!;

      const complexOutput = { labels: ['neg', 'pos'], scores: [0.1, 0.9] };
      const runPromise = handle.run('input');
      const runMsg = await waitForMsg(w, 'run');
      w.sim({ output: complexOutput, reqId: runMsg.reqId, type: 'run-result' });
      const result = await runPromise;
      expect(result).toBe(complexOutput);
    });
  });

  describe('handle.stream()', () => {
    it('enqueues stream-chunk data', async () => {
      const pool = await createPool();
      const handle = await loadModel(pool);
      const w = MockWorker.instances[0]!;

      const stream = handle.stream('input');
      const reader = stream.getReader();

      const streamMsg = await waitForMsg(w, 'run-stream');
      w.sim({ chunk: 'tok1', reqId: streamMsg.reqId, type: 'stream-chunk' });
      w.sim({ chunk: 'tok2', reqId: streamMsg.reqId, type: 'stream-chunk' });
      w.sim({ reqId: streamMsg.reqId, type: 'stream-end' });

      const chunks: unknown[] = [];
      let done = false;
      while (!done) {
        const res = await reader.read();
        done = res.done;
        if (!done)
          chunks.push(res.value);
      }
      expect(chunks).toEqual(['tok1', 'tok2']);
    });

    it('errors stream on stream-error', async () => {
      const pool = await createPool();
      const handle = await loadModel(pool);
      const w = MockWorker.instances[0]!;

      const stream = handle.stream('input');
      const reader = stream.getReader();

      const streamMsg = await waitForMsg(w, 'run-stream');
      w.sim({ error: { code: 'E', message: 'stream fail', name: 'InferisError' }, reqId: streamMsg.reqId, type: 'stream-error' });

      await expect(reader.read()).rejects.toThrow('stream fail');
    });

    it('returns error stream when model not found', async () => {
      const pool = await createPool();
      const handle = await loadModel(pool);
      pool.registry.delete('text:my-model');

      const stream = handle.stream('x');
      const reader = stream.getReader();
      await expect(reader.read()).rejects.toThrow('not found');
    });

    it('returns error stream when model not ready', async () => {
      const pool = await createPool();
      const handle = await loadModel(pool);
      pool.registry.setState('text:my-model', 'error');

      const stream = handle.stream('x');
      const reader = stream.getReader();
      await expect(reader.read()).rejects.toThrow('not ready');
    });

    it('cancel() sends abort and cleans up', async () => {
      const pool = await createPool();
      const handle = await loadModel(pool);
      const w = MockWorker.instances[0]!;

      const stream = handle.stream('input');
      const reader = stream.getReader();
      await waitForMsg(w, 'run-stream');
      await reader.cancel();

      const abortMsg = w.findMsg('abort');
      expect(abortMsg).toBeDefined();
    });

    it('stream with high priority enqueues with that priority', async () => {
      const pool = await createPool();
      const handle = await loadModel(pool);
      const w = MockWorker.instances[0]!;

      const stream = handle.stream('x', { priority: 'high' });
      const reader = stream.getReader();
      const streamMsg = await waitForMsg(w, 'run-stream');
      w.sim({ reqId: streamMsg.reqId, type: 'stream-end' });
      await reader.read();
    });

    it('forwards exact input into worker message', async () => {
      const pool = await createPool();
      const handle = await loadModel(pool);
      const w = MockWorker.instances[0]!;

      const complexInput = { messages: [{ content: 'hi', role: 'user' }] };
      const stream = handle.stream(complexInput);
      const reader = stream.getReader();
      const streamMsg = await waitForMsg(w, 'run-stream');
      expect(streamMsg.input).toEqual(complexInput);
      w.sim({ reqId: streamMsg.reqId, type: 'stream-end' });
      await reader.read();
    });

    it('forwards options without priority and signal into worker message', async () => {
      const pool = await createPool();
      const handle = await loadModel(pool);
      const w = MockWorker.instances[0]!;
      const controller = new AbortController();

      const stream = handle.stream('x', { priority: 'low', signal: controller.signal });
      const reader = stream.getReader();
      const streamMsg = await waitForMsg(w, 'run-stream');
      expect(streamMsg.options).toEqual({});
      expect(streamMsg.options).not.toHaveProperty('priority');
      expect(streamMsg.options).not.toHaveProperty('signal');
      w.sim({ reqId: streamMsg.reqId, type: 'stream-end' });
      await reader.read();
    });

    it('delivers complex object chunks unchanged', async () => {
      const pool = await createPool();
      const handle = await loadModel(pool);
      const w = MockWorker.instances[0]!;

      const stream = handle.stream('input');
      const reader = stream.getReader();

      const chunk1 = { data: [0.1, 0.2], dims: [2] };
      const chunk2 = { data: [0.3, 0.4], dims: [2] };
      const streamMsg = await waitForMsg(w, 'run-stream');
      w.sim({ chunk: chunk1, reqId: streamMsg.reqId, type: 'stream-chunk' });
      w.sim({ chunk: chunk2, reqId: streamMsg.reqId, type: 'stream-chunk' });
      w.sim({ reqId: streamMsg.reqId, type: 'stream-end' });

      const chunks: unknown[] = [];
      let done = false;
      while (!done) {
        const res = await reader.read();
        done = res.done;
        if (!done)
          chunks.push(res.value);
      }
      expect(chunks).toEqual([chunk1, chunk2]);
    });
  });

  describe('handle.dispose()', () => {
    it('sends unload-model and resolves on unload-complete', async () => {
      const pool = await createPool();
      const handle = await loadModel(pool);
      const w = MockWorker.instances[0]!;

      const disposePromise = handle.dispose();
      const unloadMsg = await waitForMsg(w, 'unload-model');
      w.sim({ reqId: unloadMsg.reqId, type: 'unload-complete' });

      await disposePromise;
      expect(handle.state).toBe('disposed');
    });

    it('rejects on unload-error', async () => {
      const pool = await createPool();
      const handle = await loadModel(pool);
      const w = MockWorker.instances[0]!;

      const disposePromise = handle.dispose();
      const unloadMsg = await waitForMsg(w, 'unload-model');
      w.sim({ error: { code: 'E', message: 'unload fail', name: 'InferisError' }, reqId: unloadMsg.reqId, type: 'unload-error' });

      await expect(disposePromise).rejects.toThrow('unload fail');
    });

    it('no-ops for already disposed model', async () => {
      const pool = await createPool();
      const handle = await loadModel(pool);
      pool.registry.setState('text:my-model', 'disposed');
      await expect(handle.dispose()).resolves.toBeUndefined();
    });
  });
});

describe('handleWorkerCrash', () => {
  it('rejects pending run requests when worker crashes', async () => {
    const pool = await createPool();
    const handle = await loadModel(pool);
    const w = MockWorker.instances[0]!;

    const runPromise = handle.run('x');
    await waitForMsg(w, 'run');
    w.simError('crashed');
    await expect(runPromise).rejects.toThrow('Worker crashed');
  });

  it('marks model as error state on worker crash', async () => {
    const pool = await createPool();
    const handle = await loadModel(pool, 'crash-model');
    const w = MockWorker.instances[0]!;
    w.simError('crash');
    expect(handle.state).toBe('error');
  });
});

describe('device-lost message', () => {
  it('sets model to error state', async () => {
    const pool = await createPool();
    const handle = await loadModel(pool, 'gpu-model');
    const w = MockWorker.instances[0]!;
    w.sim({ modelId: 'text:gpu-model', reason: 'device lost', type: 'device-lost' });
    expect(handle.state).toBe('error');
  });
});

describe('task timeout', () => {
  it('rejects pending request after timeout', async () => {
    vi.useFakeTimers();
    vi.mocked(detectCapabilities).mockResolvedValue(mockCapsWasm as never);
    const pool = await createPool({ taskTimeout: 100 });

    const p = pool.load('text', { estimatedMemoryMB: 50, model: 'slow-model' });
    const expectRej = expect(p).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(200);
    await expectRej;
    vi.useRealTimers();
  });
});
