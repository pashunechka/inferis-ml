import { beforeEach, describe, expect, it, vi } from 'vitest';
import { onnxAdapter } from '../../src/adapters/onnx.js';
import { transformersAdapter } from '../../src/adapters/transformers.js';
import { webLlmAdapter } from '../../src/adapters/web-llm.js';

describe('transformersAdapter', () => {
  it('returns factory with name=transformers', () => {
    const factory = transformersAdapter();
    expect(factory.name).toBe('transformers');
  });

  describe('create()', () => {
    beforeEach(() => {
      vi.mock('@huggingface/transformers', () => ({
        TextStreamer: class {
          constructor(public tokenizer: unknown, public opts: unknown) {}
        },
        env: { backends: { onnx: { wasm: { proxy: true } } } },
        pipeline: vi.fn(),
      }));
    });

    it('returns adapter with name=transformers', async () => {
      const factory = transformersAdapter();
      const adapter = await factory.create();
      expect(adapter.name).toBe('transformers');
    });

    it('sets env.backends.onnx.wasm.proxy to false', async () => {
      const { env } = await import('@huggingface/transformers');
      const factory = transformersAdapter();
      await factory.create();
      expect((env as { backends: { onnx: { wasm: { proxy: boolean } } } }).backends.onnx.wasm.proxy).toBe(false);
    });

    it('estimateMemoryMB uses config value when provided', async () => {
      const factory = transformersAdapter();
      const adapter = await factory.create();
      expect(adapter.estimateMemoryMB('text-generation', { estimatedMemoryMB: 512 })).toBe(512);
    });

    it('estimateMemoryMB defaults to 100 when config has no estimatedMemoryMB', async () => {
      const factory = transformersAdapter();
      const adapter = await factory.create();
      expect(adapter.estimateMemoryMB('feature-extraction', {})).toBe(100);
      expect(adapter.estimateMemoryMB('text-generation', {})).toBe(100);
    });

    it('load() calls pipeline and returns LoadedModel', async () => {
      const { pipeline } = await import('@huggingface/transformers') as { pipeline: ReturnType<typeof vi.fn> };
      const mockPipe = { tokenizer: {} };
      pipeline.mockResolvedValue(mockPipe);

      const factory = transformersAdapter();
      const adapter = await factory.create();
      const onProgress = vi.fn();

      const model = await adapter.load('feature-extraction', { model: 'test/model' }, 'wasm', onProgress);
      expect(model.instance).toBe(mockPipe);
      expect(model.memoryMB).toBe(100);
      expect(pipeline).toHaveBeenCalledWith(
        'feature-extraction',
        'test/model',
        expect.objectContaining({ device: 'wasm', dtype: 'fp32' }),
      );
    });

    it('load() calls pipeline with webgpu device', async () => {
      const { pipeline } = await import('@huggingface/transformers') as { pipeline: ReturnType<typeof vi.fn> };
      pipeline.mockResolvedValue({});
      const factory = transformersAdapter();
      const adapter = await factory.create();
      await adapter.load('feature-extraction', { model: 'test/model' }, 'webgpu', vi.fn());
      expect(pipeline).toHaveBeenCalledWith(
        'feature-extraction',
        'test/model',
        expect.objectContaining({ device: 'webgpu' }),
      );
    });

    it('load() triggers progress callbacks for each status', async () => {
      const { pipeline } = await import('@huggingface/transformers') as { pipeline: ReturnType<typeof vi.fn> };
      let progressCallback: ((info: Record<string, unknown>) => void) | undefined;
      pipeline.mockImplementation(async (_task: unknown, _model: unknown, opts: { progress_callback: (info: Record<string, unknown>) => void }) => {
        progressCallback = opts.progress_callback;
        return {};
      });

      const factory = transformersAdapter();
      const adapter = await factory.create();
      const onProgress = vi.fn();
      await adapter.load('feature-extraction', { model: 'm' }, 'wasm', onProgress);

      progressCallback!({ status: 'progress', loaded: 50, total: 100, file: 'model.bin' });
      progressCallback!({ status: 'initiate' });
      progressCallback!({ status: 'done' });

      expect(onProgress).toHaveBeenCalledWith({ loaded: 50, phase: 'model.bin', total: 100 });
      expect(onProgress).toHaveBeenCalledWith({ loaded: 0, phase: 'initiate', total: 0 });
      expect(onProgress).toHaveBeenCalledWith({ loaded: 1, phase: 'done', total: 1 });
    });

    it('run() calls pipe with input and options', async () => {
      const { pipeline } = await import('@huggingface/transformers') as { pipeline: ReturnType<typeof vi.fn> };
      const mockPipe = vi.fn().mockResolvedValue('result');
      pipeline.mockResolvedValue(mockPipe);
      const factory = transformersAdapter();
      const adapter = await factory.create();
      const model = await adapter.load('t', { model: 'm' }, 'wasm', vi.fn());
      const result = await adapter.run(model, 'input', { maxTokens: 10 });
      expect(result).toBe('result');
      expect(mockPipe).toHaveBeenCalledWith('input', { maxTokens: 10 });
    });

    it('run() passes empty object when options is undefined', async () => {
      const { pipeline } = await import('@huggingface/transformers') as { pipeline: ReturnType<typeof vi.fn> };
      const mockPipe = vi.fn().mockResolvedValue('res');
      pipeline.mockResolvedValue(mockPipe);
      const factory = transformersAdapter();
      const adapter = await factory.create();
      const model = await adapter.load('t', { model: 'm' }, 'wasm', vi.fn());
      await adapter.run(model, 'input');
      expect(mockPipe).toHaveBeenCalledWith('input', {});
    });

    it('stream() uses TextStreamer', async () => {
      const mod = await import('@huggingface/transformers') as {
        pipeline: ReturnType<typeof vi.fn>;
        TextStreamer: new (tokenizer: unknown, opts: { callback_function: (t: string) => void; skip_prompt: boolean; skip_special_tokens: boolean }) => unknown;
      };
      const mockPipe = vi.fn().mockResolvedValue(undefined);
      mockPipe.tokenizer = {};
      mod.pipeline.mockResolvedValue(mockPipe);

      const factory = transformersAdapter();
      const adapter = await factory.create();
      const model = await adapter.load('t', { model: 'm' }, 'wasm', vi.fn());
      const onChunk = vi.fn();
      await adapter.stream(model, 'input', onChunk, {});
      expect(mockPipe).toHaveBeenCalled();
    });

    it('unload() calls dispose on pipe', async () => {
      const { pipeline } = await import('@huggingface/transformers') as { pipeline: ReturnType<typeof vi.fn> };
      const dispose = vi.fn().mockResolvedValue(undefined);
      pipeline.mockResolvedValue({ dispose });
      const factory = transformersAdapter();
      const adapter = await factory.create();
      const model = await adapter.load('t', { model: 'm' }, 'wasm', vi.fn());
      await adapter.unload(model);
      expect(dispose).toHaveBeenCalled();
    });

    it('unload() does not throw when dispose is absent', async () => {
      const { pipeline } = await import('@huggingface/transformers') as { pipeline: ReturnType<typeof vi.fn> };
      pipeline.mockResolvedValue({});
      const factory = transformersAdapter();
      const adapter = await factory.create();
      const model = await adapter.load('t', { model: 'm' }, 'wasm', vi.fn());
      await expect(adapter.unload(model)).resolves.toBeUndefined();
    });

    it('run() spreads array input as positional args', async () => {
      const { pipeline } = await import('@huggingface/transformers') as { pipeline: ReturnType<typeof vi.fn> };
      const mockPipe = vi.fn().mockResolvedValue('answer');
      pipeline.mockResolvedValue(mockPipe);
      const factory = transformersAdapter();
      const adapter = await factory.create();
      const model = await adapter.load('t', { model: 'm' }, 'wasm', vi.fn());
      await adapter.run(model, ['context text', 'question text'], { topK: 5 });
      expect(mockPipe).toHaveBeenCalledWith('context text', 'question text', { topK: 5 });
    });

    it('run() spreads single-element array input', async () => {
      const { pipeline } = await import('@huggingface/transformers') as { pipeline: ReturnType<typeof vi.fn> };
      const mockPipe = vi.fn().mockResolvedValue('res');
      pipeline.mockResolvedValue(mockPipe);
      const factory = transformersAdapter();
      const adapter = await factory.create();
      const model = await adapter.load('t', { model: 'm' }, 'wasm', vi.fn());
      await adapter.run(model, ['only arg']);
      expect(mockPipe).toHaveBeenCalledWith('only arg', {});
    });

    it('run() serializes Tensor-like output from pipe', async () => {
      const { pipeline } = await import('@huggingface/transformers') as { pipeline: ReturnType<typeof vi.fn> };
      const tensorOutput = {
        data: Float32Array.from([0.9, 0.1]),
        dims: [1, 2],
        size: 2,
        type: 'float32',
      };
      const mockPipe = vi.fn().mockResolvedValue(tensorOutput);
      pipeline.mockResolvedValue(mockPipe);
      const factory = transformersAdapter();
      const adapter = await factory.create();
      const model = await adapter.load('t', { model: 'm' }, 'wasm', vi.fn());
      const result = await adapter.run(model, 'text') as Record<string, unknown>;
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data).toEqual([expect.closeTo(0.9), expect.closeTo(0.1)]);
      expect(result.dims).toEqual([1, 2]);
    });

    it('stream() delivers tokens to onChunk via TextStreamer callback', async () => {
      const mod = await import('@huggingface/transformers') as { pipeline: ReturnType<typeof vi.fn> };
      const mockPipe = vi.fn(async (_input: unknown, opts: Record<string, unknown>) => {
        const streamer = opts.streamer as { opts: { callback_function: (t: string) => void } };
        streamer.opts.callback_function('Hello');
        streamer.opts.callback_function(' world');
      });
      mockPipe.tokenizer = {};
      mod.pipeline.mockResolvedValue(mockPipe);

      const factory = transformersAdapter();
      const adapter = await factory.create();
      const model = await adapter.load('t', { model: 'm' }, 'wasm', vi.fn());
      const onChunk = vi.fn();
      await adapter.stream(model, 'input', onChunk);
      expect(onChunk).toHaveBeenCalledTimes(2);
      expect(onChunk).toHaveBeenCalledWith('Hello');
      expect(onChunk).toHaveBeenCalledWith(' world');
    });

    it('stream() merges user options with streamer', async () => {
      const mod = await import('@huggingface/transformers') as { pipeline: ReturnType<typeof vi.fn> };
      const mockPipe = vi.fn().mockResolvedValue(undefined);
      mockPipe.tokenizer = {};
      mod.pipeline.mockResolvedValue(mockPipe);

      const factory = transformersAdapter();
      const adapter = await factory.create();
      const model = await adapter.load('t', { model: 'm' }, 'wasm', vi.fn());
      await adapter.stream(model, 'input', vi.fn(), { max_new_tokens: 100 });
      expect(mockPipe).toHaveBeenCalledWith('input', expect.objectContaining({
        max_new_tokens: 100,
        streamer: expect.any(Object),
      }));
    });

    it('load() rejects when pipeline() throws', async () => {
      const { pipeline } = await import('@huggingface/transformers') as { pipeline: ReturnType<typeof vi.fn> };
      pipeline.mockRejectedValue(new Error('model not found'));
      const factory = transformersAdapter();
      const adapter = await factory.create();
      await expect(adapter.load('t', { model: 'bad' }, 'wasm', vi.fn())).rejects.toThrow('model not found');
    });

    it('run() rejects when pipe() throws', async () => {
      const { pipeline } = await import('@huggingface/transformers') as { pipeline: ReturnType<typeof vi.fn> };
      const mockPipe = vi.fn().mockRejectedValue(new Error('inference failed'));
      pipeline.mockResolvedValue(mockPipe);
      const factory = transformersAdapter();
      const adapter = await factory.create();
      const model = await adapter.load('t', { model: 'm' }, 'wasm', vi.fn());
      await expect(adapter.run(model, 'input')).rejects.toThrow('inference failed');
    });

    it('stream() rejects when pipe() throws', async () => {
      const mod = await import('@huggingface/transformers') as {
        pipeline: ReturnType<typeof vi.fn>;
        TextStreamer: new (...args: unknown[]) => unknown;
      };
      const mockPipe = vi.fn().mockRejectedValue(new Error('stream failed'));
      mockPipe.tokenizer = {};
      mod.pipeline.mockResolvedValue(mockPipe);
      const factory = transformersAdapter();
      const adapter = await factory.create();
      const model = await adapter.load('t', { model: 'm' }, 'wasm', vi.fn());
      await expect(adapter.stream(model, 'input', vi.fn())).rejects.toThrow('stream failed');
    });
  });
});

describe('onnxAdapter', () => {
  it('returns factory with name=onnx', () => {
    expect(onnxAdapter().name).toBe('onnx');
  });

  describe('create()', () => {
    beforeEach(() => {
      vi.mock('onnxruntime-web', () => ({
        InferenceSession: {
          create: vi.fn(),
        },
      }));
    });

    it('returns adapter with name=onnx', async () => {
      const factory = onnxAdapter();
      const adapter = await factory.create();
      expect(adapter.name).toBe('onnx');
    });

    it('estimateMemoryMB uses config value', async () => {
      const adapter = await onnxAdapter().create();
      expect(adapter.estimateMemoryMB('t', { estimatedMemoryMB: 128 })).toBe(128);
    });

    it('estimateMemoryMB defaults to 50', async () => {
      const adapter = await onnxAdapter().create();
      expect(adapter.estimateMemoryMB('t', {})).toBe(50);
    });

    it('load() creates session with wasm provider', async () => {
      const ort = await import('onnxruntime-web') as { InferenceSession: { create: ReturnType<typeof vi.fn> } };
      const mockSession = { release: vi.fn() };
      ort.InferenceSession.create.mockResolvedValue(mockSession);

      const adapter = await onnxAdapter().create();
      const onProgress = vi.fn();
      const model = await adapter.load('custom', { model: 'model.onnx' }, 'wasm', onProgress);

      expect(ort.InferenceSession.create).toHaveBeenCalledWith('model.onnx', expect.objectContaining({
        executionProviders: ['wasm'],
      }));
      expect(onProgress).toHaveBeenCalledWith({ loaded: 0, phase: 'downloading', total: 0 });
      expect(onProgress).toHaveBeenCalledWith({ loaded: 1, phase: 'done', total: 1 });
      expect(model.instance).toBe(mockSession);
    });

    it('load() creates session with webgpu provider', async () => {
      const ort = await import('onnxruntime-web') as { InferenceSession: { create: ReturnType<typeof vi.fn> } };
      ort.InferenceSession.create.mockResolvedValue({});
      const adapter = await onnxAdapter().create();
      await adapter.load('t', { model: 'm.onnx' }, 'webgpu', vi.fn());
      expect(ort.InferenceSession.create).toHaveBeenCalledWith('m.onnx', expect.objectContaining({
        executionProviders: ['webgpu', 'wasm'],
      }));
    });

    it('run() calls session.run', async () => {
      const ort = await import('onnxruntime-web') as { InferenceSession: { create: ReturnType<typeof vi.fn> } };
      const runFn = vi.fn().mockResolvedValue({ output: 'tensor' });
      ort.InferenceSession.create.mockResolvedValue({ run: runFn });

      const adapter = await onnxAdapter().create();
      const model = await adapter.load('t', { model: 'm.onnx' }, 'wasm', vi.fn());
      const result = await adapter.run(model, { feeds: { input: 'tensor' }, outputNames: ['out'] });
      expect(runFn).toHaveBeenCalledWith({ input: 'tensor' }, ['out']);
      expect(result).toEqual({ output: 'tensor' });
    });

    it('stream() runs inference and calls onChunk', async () => {
      const ort = await import('onnxruntime-web') as { InferenceSession: { create: ReturnType<typeof vi.fn> } };
      const runFn = vi.fn().mockResolvedValue({ out: 'val' });
      ort.InferenceSession.create.mockResolvedValue({ run: runFn });

      const adapter = await onnxAdapter().create();
      const model = await adapter.load('t', { model: 'm.onnx' }, 'wasm', vi.fn());
      const onChunk = vi.fn();
      await adapter.stream(model, { feeds: { x: 'y' } }, onChunk);
      expect(onChunk).toHaveBeenCalledWith({ out: 'val' });
    });

    it('unload() calls session.release', async () => {
      const ort = await import('onnxruntime-web') as { InferenceSession: { create: ReturnType<typeof vi.fn> } };
      const release = vi.fn().mockResolvedValue(undefined);
      ort.InferenceSession.create.mockResolvedValue({ release });

      const adapter = await onnxAdapter().create();
      const model = await adapter.load('t', { model: 'm.onnx' }, 'wasm', vi.fn());
      await adapter.unload(model);
      expect(release).toHaveBeenCalled();
    });

    it('unload() does not throw when release is absent', async () => {
      const ort = await import('onnxruntime-web') as { InferenceSession: { create: ReturnType<typeof vi.fn> } };
      ort.InferenceSession.create.mockResolvedValue({});

      const adapter = await onnxAdapter().create();
      const model = await adapter.load('t', { model: 'm.onnx' }, 'wasm', vi.fn());
      await expect(adapter.unload(model)).resolves.toBeUndefined();
    });

    it('stream() passes options to session.run', async () => {
      const ort = await import('onnxruntime-web') as { InferenceSession: { create: ReturnType<typeof vi.fn> } };
      const runFn = vi.fn().mockResolvedValue({ out: 'val' });
      ort.InferenceSession.create.mockResolvedValue({ run: runFn });

      const adapter = await onnxAdapter().create();
      const model = await adapter.load('t', { model: 'm.onnx' }, 'wasm', vi.fn());
      const onChunk = vi.fn();
      await adapter.stream(model, { feeds: { x: 'y' }, outputNames: ['out'] }, onChunk, { executionOptions: true });
      expect(runFn).toHaveBeenCalledWith({ x: 'y' }, ['out'], { executionOptions: true });
    });

    it('run() ignores options parameter', async () => {
      const ort = await import('onnxruntime-web') as { InferenceSession: { create: ReturnType<typeof vi.fn> } };
      const runFn = vi.fn().mockResolvedValue({ output: 'tensor' });
      ort.InferenceSession.create.mockResolvedValue({ run: runFn });

      const adapter = await onnxAdapter().create();
      const model = await adapter.load('t', { model: 'm.onnx' }, 'wasm', vi.fn());
      await adapter.run(model, { feeds: { input: 'tensor' } }, { shouldBeIgnored: true });
      expect(runFn).toHaveBeenCalledWith({ input: 'tensor' }, undefined);
    });

    it('load() rejects when InferenceSession.create throws', async () => {
      const ort = await import('onnxruntime-web') as { InferenceSession: { create: ReturnType<typeof vi.fn> } };
      ort.InferenceSession.create.mockRejectedValue(new Error('invalid model'));

      const adapter = await onnxAdapter().create();
      await expect(adapter.load('t', { model: 'bad.onnx' }, 'wasm', vi.fn())).rejects.toThrow('invalid model');
    });

    it('run() rejects when session.run throws', async () => {
      const ort = await import('onnxruntime-web') as { InferenceSession: { create: ReturnType<typeof vi.fn> } };
      const runFn = vi.fn().mockRejectedValue(new Error('runtime error'));
      ort.InferenceSession.create.mockResolvedValue({ run: runFn });

      const adapter = await onnxAdapter().create();
      const model = await adapter.load('t', { model: 'm.onnx' }, 'wasm', vi.fn());
      await expect(adapter.run(model, { feeds: { x: 'y' } })).rejects.toThrow('runtime error');
    });
  });
});

describe('webLlmAdapter', () => {
  it('returns factory with name=web-llm', () => {
    expect(webLlmAdapter().name).toBe('web-llm');
  });

  describe('create()', () => {
    beforeEach(() => {
      vi.mock('@mlc-ai/web-llm', () => ({
        CreateMLCEngine: vi.fn(),
      }));
    });

    it('returns adapter with name=web-llm', async () => {
      const adapter = await webLlmAdapter().create();
      expect(adapter.name).toBe('web-llm');
    });

    it('estimateMemoryMB uses config value', async () => {
      const adapter = await webLlmAdapter().create();
      expect(adapter.estimateMemoryMB('t', { estimatedMemoryMB: 4096 })).toBe(4096);
    });

    it('estimateMemoryMB defaults to 2000', async () => {
      const adapter = await webLlmAdapter().create();
      expect(adapter.estimateMemoryMB('t', {})).toBe(2000);
    });

    it('load() creates engine and returns LoadedModel', async () => {
      const { CreateMLCEngine } = await import('@mlc-ai/web-llm') as { CreateMLCEngine: ReturnType<typeof vi.fn> };
      const mockEngine = { chat: {}, unload: vi.fn() };
      CreateMLCEngine.mockImplementation(async (_id: unknown, opts: { initProgressCallback: (info: { progress: number; text: string }) => void }) => {
        opts.initProgressCallback({ progress: 0.5, text: 'loading...' });
        return mockEngine;
      });

      const adapter = await webLlmAdapter().create();
      const onProgress = vi.fn();
      const model = await adapter.load('text-generation', { model: 'Llama-3' }, 'webgpu', onProgress);

      expect(model.instance).toBe(mockEngine);
      expect(model.memoryMB).toBe(2000);
      expect(onProgress).toHaveBeenCalledWith({ loaded: 0.5, phase: 'loading...', total: 1 });
      expect(CreateMLCEngine).toHaveBeenCalledWith('Llama-3', expect.any(Object));
    });

    it('run() calls engine.chat.completions.create', async () => {
      const { CreateMLCEngine } = await import('@mlc-ai/web-llm') as { CreateMLCEngine: ReturnType<typeof vi.fn> };
      const createFn = vi.fn().mockResolvedValue({
        choices: [{ message: { content: 'response text' } }],
      });
      CreateMLCEngine.mockResolvedValue({ chat: { completions: { create: createFn } } });

      const adapter = await webLlmAdapter().create();
      const model = await adapter.load('t', { model: 'm' }, 'webgpu', vi.fn());
      const result = await adapter.run(model, { messages: [{ role: 'user', content: 'hi' }] });
      expect(result).toBe('response text');
      expect(createFn).toHaveBeenCalledWith(expect.objectContaining({ stream: false }));
    });

    it('run() returns empty string when no choices', async () => {
      const { CreateMLCEngine } = await import('@mlc-ai/web-llm') as { CreateMLCEngine: ReturnType<typeof vi.fn> };
      const createFn = vi.fn().mockResolvedValue({ choices: [] });
      CreateMLCEngine.mockResolvedValue({ chat: { completions: { create: createFn } } });

      const adapter = await webLlmAdapter().create();
      const model = await adapter.load('t', { model: 'm' }, 'webgpu', vi.fn());
      const result = await adapter.run(model, { messages: [] });
      expect(result).toBe('');
    });

    it('stream() iterates chunks and calls onChunk for non-empty deltas', async () => {
      const { CreateMLCEngine } = await import('@mlc-ai/web-llm') as { CreateMLCEngine: ReturnType<typeof vi.fn> };
      const chunks = [
        { choices: [{ delta: { content: 'Hello' } }] },
        { choices: [{ delta: { content: '' } }] },
        { choices: [{ delta: { content: ' world' } }] },
      ];
      async function* makeAsyncGen() {
        yield* chunks;
      }
      const createFn = vi.fn().mockResolvedValue(makeAsyncGen());
      CreateMLCEngine.mockResolvedValue({ chat: { completions: { create: createFn } } });

      const adapter = await webLlmAdapter().create();
      const model = await adapter.load('t', { model: 'm' }, 'webgpu', vi.fn());
      const onChunk = vi.fn();
      await adapter.stream(model, { messages: [] }, onChunk);
      expect(onChunk).toHaveBeenCalledTimes(2);
      expect(onChunk).toHaveBeenCalledWith('Hello');
      expect(onChunk).toHaveBeenCalledWith(' world');
    });

    it('unload() calls engine.unload', async () => {
      const { CreateMLCEngine } = await import('@mlc-ai/web-llm') as { CreateMLCEngine: ReturnType<typeof vi.fn> };
      const unload = vi.fn().mockResolvedValue(undefined);
      CreateMLCEngine.mockResolvedValue({ unload });

      const adapter = await webLlmAdapter().create();
      const model = await adapter.load('t', { model: 'm' }, 'webgpu', vi.fn());
      await adapter.unload(model);
      expect(unload).toHaveBeenCalled();
    });

    it('unload() does not throw when engine.unload is absent', async () => {
      const { CreateMLCEngine } = await import('@mlc-ai/web-llm') as { CreateMLCEngine: ReturnType<typeof vi.fn> };
      CreateMLCEngine.mockResolvedValue({});

      const adapter = await webLlmAdapter().create();
      const model = await adapter.load('t', { model: 'm' }, 'webgpu', vi.fn());
      await expect(adapter.unload(model)).resolves.toBeUndefined();
    });

    it('run() merges user options into create() call', async () => {
      const { CreateMLCEngine } = await import('@mlc-ai/web-llm') as { CreateMLCEngine: ReturnType<typeof vi.fn> };
      const createFn = vi.fn().mockResolvedValue({
        choices: [{ message: { content: 'ok' } }],
      });
      CreateMLCEngine.mockResolvedValue({ chat: { completions: { create: createFn } } });

      const adapter = await webLlmAdapter().create();
      const model = await adapter.load('t', { model: 'm' }, 'webgpu', vi.fn());
      await adapter.run(model, { messages: [{ role: 'user', content: 'hi' }] }, { temperature: 0.7, top_p: 0.9 });
      expect(createFn).toHaveBeenCalledWith(expect.objectContaining({
        messages: [{ role: 'user', content: 'hi' }],
        stream: false,
        temperature: 0.7,
        top_p: 0.9,
      }));
    });

    it('run() overrides user stream option with stream: false', async () => {
      const { CreateMLCEngine } = await import('@mlc-ai/web-llm') as { CreateMLCEngine: ReturnType<typeof vi.fn> };
      const createFn = vi.fn().mockResolvedValue({
        choices: [{ message: { content: 'ok' } }],
      });
      CreateMLCEngine.mockResolvedValue({ chat: { completions: { create: createFn } } });

      const adapter = await webLlmAdapter().create();
      const model = await adapter.load('t', { model: 'm' }, 'webgpu', vi.fn());
      await adapter.run(model, { messages: [] }, { stream: true });
      expect(createFn).toHaveBeenCalledWith(expect.objectContaining({ stream: false }));
    });

    it('stream() merges user options into create() call', async () => {
      const { CreateMLCEngine } = await import('@mlc-ai/web-llm') as { CreateMLCEngine: ReturnType<typeof vi.fn> };
      async function* empty() { /* yields nothing */ }
      const createFn = vi.fn().mockResolvedValue(empty());
      CreateMLCEngine.mockResolvedValue({ chat: { completions: { create: createFn } } });

      const adapter = await webLlmAdapter().create();
      const model = await adapter.load('t', { model: 'm' }, 'webgpu', vi.fn());
      await adapter.stream(model, { messages: [] }, vi.fn(), { temperature: 0.5 });
      expect(createFn).toHaveBeenCalledWith(expect.objectContaining({
        stream: true,
        temperature: 0.5,
      }));
    });

    it('stream() skips chunks with empty choices array', async () => {
      const { CreateMLCEngine } = await import('@mlc-ai/web-llm') as { CreateMLCEngine: ReturnType<typeof vi.fn> };
      const chunks = [
        { choices: [] },
        { choices: [{ delta: { content: 'ok' } }] },
      ];
      async function* makeGen() {
        yield* chunks;
      }
      const createFn = vi.fn().mockResolvedValue(makeGen());
      CreateMLCEngine.mockResolvedValue({ chat: { completions: { create: createFn } } });

      const adapter = await webLlmAdapter().create();
      const model = await adapter.load('t', { model: 'm' }, 'webgpu', vi.fn());
      const onChunk = vi.fn();
      await adapter.stream(model, { messages: [] }, onChunk);
      expect(onChunk).toHaveBeenCalledTimes(1);
      expect(onChunk).toHaveBeenCalledWith('ok');
    });

    it('stream() skips chunks where delta has no content', async () => {
      const { CreateMLCEngine } = await import('@mlc-ai/web-llm') as { CreateMLCEngine: ReturnType<typeof vi.fn> };
      const chunks = [
        { choices: [{ delta: {} }] },
        { choices: [{ delta: { content: null } }] },
        { choices: [{ delta: { content: 'token' } }] },
      ];
      async function* makeGen() {
        yield* chunks;
      }
      const createFn = vi.fn().mockResolvedValue(makeGen());
      CreateMLCEngine.mockResolvedValue({ chat: { completions: { create: createFn } } });

      const adapter = await webLlmAdapter().create();
      const model = await adapter.load('t', { model: 'm' }, 'webgpu', vi.fn());
      const onChunk = vi.fn();
      await adapter.stream(model, { messages: [] }, onChunk);
      expect(onChunk).toHaveBeenCalledTimes(1);
      expect(onChunk).toHaveBeenCalledWith('token');
    });

    it('load() rejects when CreateMLCEngine throws', async () => {
      const { CreateMLCEngine } = await import('@mlc-ai/web-llm') as { CreateMLCEngine: ReturnType<typeof vi.fn> };
      CreateMLCEngine.mockRejectedValue(new Error('gpu not available'));

      const adapter = await webLlmAdapter().create();
      await expect(adapter.load('t', { model: 'm' }, 'webgpu', vi.fn())).rejects.toThrow('gpu not available');
    });

    it('run() rejects when engine.chat.completions.create throws', async () => {
      const { CreateMLCEngine } = await import('@mlc-ai/web-llm') as { CreateMLCEngine: ReturnType<typeof vi.fn> };
      const createFn = vi.fn().mockRejectedValue(new Error('completion error'));
      CreateMLCEngine.mockResolvedValue({ chat: { completions: { create: createFn } } });

      const adapter = await webLlmAdapter().create();
      const model = await adapter.load('t', { model: 'm' }, 'webgpu', vi.fn());
      await expect(adapter.run(model, { messages: [] })).rejects.toThrow('completion error');
    });

    it('stream() rejects mid-iteration after partial chunks delivered', async () => {
      const { CreateMLCEngine } = await import('@mlc-ai/web-llm') as { CreateMLCEngine: ReturnType<typeof vi.fn> };
      async function* failingGen() {
        yield { choices: [{ delta: { content: 'partial' } }] };
        throw new Error('stream interrupted');
      }
      const createFn = vi.fn().mockResolvedValue(failingGen());
      CreateMLCEngine.mockResolvedValue({ chat: { completions: { create: createFn } } });

      const adapter = await webLlmAdapter().create();
      const model = await adapter.load('t', { model: 'm' }, 'webgpu', vi.fn());
      const onChunk = vi.fn();
      await expect(adapter.stream(model, { messages: [] }, onChunk)).rejects.toThrow('stream interrupted');
      expect(onChunk).toHaveBeenCalledTimes(1);
      expect(onChunk).toHaveBeenCalledWith('partial');
    });
  });
});
