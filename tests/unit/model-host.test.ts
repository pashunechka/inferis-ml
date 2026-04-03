import type { LoadedModel, ModelAdapter, ModelAdapterFactory } from '../../src/core/types.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelHost } from '../../src/worker/model-host.js';

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

describe('modelHost', () => {
  let host: ModelHost;
  let adapter: ModelAdapter;
  let factory: ModelAdapterFactory;

  beforeEach(() => {
    host = new ModelHost();
    adapter = createMockAdapter();
    factory = createMockFactory(adapter);
  });

  describe('initAdapter', () => {
    it('calls factory.create()', async () => {
      await host.initAdapter(factory);
      expect(factory.create).toHaveBeenCalledOnce();
    });

    it('skips re-creation if same adapter name', async () => {
      await host.initAdapter(factory);
      await host.initAdapter(factory);
      expect(factory.create).toHaveBeenCalledOnce();
    });

    it('replaces adapter when name differs', async () => {
      await host.initAdapter(factory);

      const otherAdapter = createMockAdapter('other');
      const otherFactory = createMockFactory(otherAdapter);
      await host.initAdapter(otherFactory);

      expect(otherFactory.create).toHaveBeenCalledOnce();
    });
  });

  describe('isReady', () => {
    it('returns false before initialization', () => {
      expect(host.isReady()).toBe(false);
    });

    it('returns true after initialization', async () => {
      await host.initAdapter(factory);
      expect(host.isReady()).toBe(true);
    });
  });

  describe('load', () => {
    it('throws if adapter not initialized', async () => {
      await expect(host.load('m1', 'task', {}, 'wasm', vi.fn()))
        .rejects
        .toThrow('Adapter not initialized');
    });

    it('forwards exact args to adapter.load', async () => {
      await host.initAdapter(factory);
      const config = { model: 'test/model', dtype: 'fp16' };
      const onProgress = vi.fn();
      await host.load('m1', 'feature-extraction', config, 'webgpu', onProgress);

      expect(adapter.load).toHaveBeenCalledWith('feature-extraction', config, 'webgpu', onProgress);
    });

    it('returns LoadedModel from adapter', async () => {
      const loadedModel: LoadedModel = { instance: { pipe: true }, memoryMB: 128 };
      (adapter.load as ReturnType<typeof vi.fn>).mockResolvedValue(loadedModel);
      await host.initAdapter(factory);

      const result = await host.load('m1', 'task', {}, 'wasm', vi.fn());
      expect(result).toBe(loadedModel);
    });

    it('deduplicates by modelId — returns existing model', async () => {
      await host.initAdapter(factory);
      const first = await host.load('m1', 'task', {}, 'wasm', vi.fn());
      const second = await host.load('m1', 'task', {}, 'wasm', vi.fn());

      expect(first).toBe(second);
      expect(adapter.load).toHaveBeenCalledOnce();
    });

    it('stores model in internal map', async () => {
      await host.initAdapter(factory);
      await host.load('m1', 'task', {}, 'wasm', vi.fn());
      expect(host.has('m1')).toBe(true);
    });
  });

  describe('run', () => {
    it('throws if adapter not initialized', async () => {
      await expect(host.run('m1', 'input')).rejects.toThrow('Adapter not initialized');
    });

    it('throws if modelId not loaded', async () => {
      await host.initAdapter(factory);
      await expect(host.run('unknown', 'input')).rejects.toThrow('not loaded');
    });

    it('forwards exact (loadedModel, input, options) by reference', async () => {
      const loadedModel: LoadedModel = { instance: {}, memoryMB: 50 };
      (adapter.load as ReturnType<typeof vi.fn>).mockResolvedValue(loadedModel);
      await host.initAdapter(factory);
      await host.load('m1', 'task', {}, 'wasm', vi.fn());

      const input = { text: 'hello', nested: { arr: [1, 2] } };
      const options = { temperature: 0.7, topK: 50 };
      await host.run('m1', input, options);

      expect(adapter.run).toHaveBeenCalledWith(loadedModel, input, options);
      const callArgs = (adapter.run as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(callArgs[0]).toBe(loadedModel);
      expect(callArgs[1]).toBe(input);
      expect(callArgs[2]).toBe(options);
    });

    it('returns exact result from adapter.run (same reference)', async () => {
      const output = { result: { scores: [0.9] }, meta: { tokens: 42 } };
      (adapter.run as ReturnType<typeof vi.fn>).mockResolvedValue(output);
      await host.initAdapter(factory);
      await host.load('m1', 'task', {}, 'wasm', vi.fn());

      const result = await host.run('m1', 'input');
      expect(result).toBe(output);
    });

    it('passes undefined options when not provided', async () => {
      await host.initAdapter(factory);
      await host.load('m1', 'task', {}, 'wasm', vi.fn());
      await host.run('m1', 'input');

      expect(adapter.run).toHaveBeenCalledWith(expect.anything(), 'input', undefined);
    });
  });

  describe('stream', () => {
    it('throws if adapter not initialized', async () => {
      await expect(host.stream('m1', 'input', vi.fn())).rejects.toThrow('Adapter not initialized');
    });

    it('throws if modelId not loaded', async () => {
      await host.initAdapter(factory);
      await expect(host.stream('unknown', 'input', vi.fn())).rejects.toThrow('not loaded');
    });

    it('forwards exact (loadedModel, input, onChunk, options) by reference', async () => {
      const loadedModel: LoadedModel = { instance: {}, memoryMB: 50 };
      (adapter.load as ReturnType<typeof vi.fn>).mockResolvedValue(loadedModel);
      await host.initAdapter(factory);
      await host.load('m1', 'task', {}, 'wasm', vi.fn());

      const input = { messages: [{ role: 'user', content: 'hi' }] };
      const onChunk = vi.fn();
      const options = { maxTokens: 100 };
      await host.stream('m1', input, onChunk, options);

      const callArgs = (adapter.stream as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(callArgs[0]).toBe(loadedModel);
      expect(callArgs[1]).toBe(input);
      expect(callArgs[2]).toBe(onChunk);
      expect(callArgs[3]).toBe(options);
    });
  });

  describe('unload', () => {
    it('delegates to adapter.unload with loaded model', async () => {
      const loadedModel: LoadedModel = { instance: {}, memoryMB: 50 };
      (adapter.load as ReturnType<typeof vi.fn>).mockResolvedValue(loadedModel);
      await host.initAdapter(factory);
      await host.load('m1', 'task', {}, 'wasm', vi.fn());

      await host.unload('m1');
      expect(adapter.unload).toHaveBeenCalledWith(loadedModel);
    });

    it('removes model from internal map after unload', async () => {
      await host.initAdapter(factory);
      await host.load('m1', 'task', {}, 'wasm', vi.fn());
      expect(host.has('m1')).toBe(true);

      await host.unload('m1');
      expect(host.has('m1')).toBe(false);
    });

    it('no-op for unknown modelId', async () => {
      await host.initAdapter(factory);
      await expect(host.unload('nonexistent')).resolves.toBeUndefined();
      expect(adapter.unload).not.toHaveBeenCalled();
    });
  });

  describe('has', () => {
    it('returns true for loaded model', async () => {
      await host.initAdapter(factory);
      await host.load('m1', 'task', {}, 'wasm', vi.fn());
      expect(host.has('m1')).toBe(true);
    });

    it('returns false for non-existent model', () => {
      expect(host.has('unknown')).toBe(false);
    });
  });

  describe('estimateMemoryMB', () => {
    it('delegates to adapter when initialized', async () => {
      (adapter.estimateMemoryMB as ReturnType<typeof vi.fn>).mockReturnValue(256);
      await host.initAdapter(factory);

      const result = host.estimateMemoryMB('text-generation', { model: 'llm' });
      expect(result).toBe(256);
      expect(adapter.estimateMemoryMB).toHaveBeenCalledWith('text-generation', { model: 'llm' });
    });

    it('returns 0 when adapter not initialized', () => {
      expect(host.estimateMemoryMB('task', {})).toBe(0);
    });
  });
});
