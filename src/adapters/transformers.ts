import type {
  Device,
  LoadedModel,
  LoadProgressEvent,
  ModelAdapter,
  ModelAdapterFactory,
} from '../core/types.js';

// eslint-disable-next-line ts/no-explicit-any
type AnyPipeline = any;

/**
 * Adapter for @huggingface/transformers v3+.
 *
 * @remarks
 * The adapter is instantiated INSIDE the worker via `create()`.
 * The heavy `@huggingface/transformers` library is dynamically imported
 * inside the worker, keeping the main thread bundle lightweight.
 *
 * @example
 * ```ts
 * import { createPool } from 'inferis-ml';
 * import { transformersAdapter } from 'inferis-ml/adapters/transformers';
 *
 * const pool = await createPool({ adapter: transformersAdapter() });
 * const model = await pool.load<number[][]>('feature-extraction', {
 *   model: 'mixedbread-ai/mxbai-embed-xsmall-v1',
 * });
 * ```
 */
export function transformersAdapter(): ModelAdapterFactory {
  return {
    name: 'transformers',

    async create(): Promise<ModelAdapter> {
      // Dynamic import — runs inside the worker only
      // @ts-expect-error - optional peer dependency, resolved at runtime inside worker
      const { pipeline, TextStreamer, env } = await import('@huggingface/transformers');

      // Use ONNX WASM backend with optimizations
      env.backends.onnx.wasm.proxy = false;

      return {
        name: 'transformers',

        estimateMemoryMB(_task: string, config: Record<string, unknown>): number {
          return (config.estimatedMemoryMB as number | undefined) ?? 100;
        },

        async load(
          task: string,
          config: Record<string, unknown>,
          device: Device,
          onProgress: (event: LoadProgressEvent) => void,
        ): Promise<LoadedModel> {
          const model = config.model as string;
          const dtype = (config.dtype as string | undefined) ?? 'fp32';

          const fileTotals = new Map<string, number>();

          const pipe = await pipeline(task as Parameters<typeof pipeline>[0], model, {
            device: device === 'webgpu' ? 'webgpu' : 'wasm',
            dtype,
            progress_callback: (info: Record<string, unknown>) => {
              if (info.status === 'progress') {
                const file = (info.file as string) ?? 'unknown';
                const total = (info.total as number) ?? 0;
                fileTotals.set(file, total);
                onProgress({
                  loaded: (info.loaded as number) ?? 0,
                  phase: file,
                  total,
                });
              }
              else if (info.status === 'initiate') {
                onProgress({ loaded: 0, phase: 'initiate', total: 0 });
              }
              else if (info.status === 'done') {
                onProgress({ loaded: 1, phase: 'done', total: 1 });
              }
            },
          });

          let totalBytes = 0;
          for (const size of fileTotals.values()) totalBytes += size;

          return {
            instance: pipe,
            memoryMB: Math.ceil(totalBytes / (1024 * 1024)) || 100,
          };
        },

        async run(model: LoadedModel, input: unknown, options?: unknown): Promise<unknown> {
          const pipe = model.instance as AnyPipeline;
          const result = Array.isArray(input)
            ? await pipe(...(input as [unknown, ...unknown[]]), options ?? {})
            : await pipe(input, options ?? {});
          return serializeOutput(result);
        },

        async stream(
          model: LoadedModel,
          input: unknown,
          onChunk: (chunk: unknown) => void,
          options?: unknown,
        ): Promise<void> {
          const pipe = model.instance as AnyPipeline;

          const streamer = new TextStreamer(pipe.tokenizer, {
            callback_function: (text: string) => onChunk(text),
            skip_prompt: true,
            skip_special_tokens: true,
          });

          await pipe(input, {
            ...(options as object ?? {}),
            streamer,
          });
        },

        async unload(model: LoadedModel): Promise<void> {
          const pipe = model.instance as AnyPipeline;
          await pipe.dispose?.();
        },
      };
    },
  };
}

/**
 * Recursively converts Tensor class instances and typed arrays to plain
 * structured-clone-compatible objects so they can cross the worker boundary.
 */
export function serializeOutput(value: unknown): unknown {
  if (value === null || typeof value !== 'object')
    return value;

  if (Array.isArray(value))
    return value.map(serializeOutput);

  const obj = value as Record<string, unknown>;

  if (typeof obj.data !== 'undefined' && Array.isArray(obj.dims)) {
    return {
      data: Array.from(obj.data as ArrayLike<number>),
      dims: obj.dims as number[],
      size: obj.size,
      type: obj.type,
    };
  }

  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [k, serializeOutput(v)]),
  );
}
