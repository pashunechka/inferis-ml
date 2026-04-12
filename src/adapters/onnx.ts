import type {
  Device,
  LoadedModel,
  LoadProgressEvent,
  ModelAdapter,
  ModelAdapterFactory,
} from '../core/types.js';

// eslint-disable-next-line ts/no-explicit-any
type InferenceSession = any;
// eslint-disable-next-line ts/no-explicit-any
type Tensor = any;

interface OnnxInput {
  feeds: Record<string, Tensor>;
  outputNames?: string[];
}

/**
 * Adapter for onnxruntime-web.
 *
 * @remarks
 * Provides low-level access to ONNX model inference.
 * Use for custom models not supported by transformers.js or web-llm.
 * Input must be pre-processed `OrtTensor` instances.
 *
 * @example
 * ```ts
 * import { createPool } from 'inferis-ml';
 * import { onnxAdapter } from 'inferis-ml/adapters/onnx';
 * import * as ort from 'onnxruntime-web';
 *
 * const pool = await createPool({ adapter: onnxAdapter() });
 * const model = await pool.load('custom', {
 *   model: 'https://example.com/model.onnx',
 * });
 *
 * const input = new ort.Tensor('float32', data, [1, 3, 224, 224]);
 * const output = await model.run({ feeds: { input } });
 * ```
 */
export function onnxAdapter(): ModelAdapterFactory {
  return {
    name: 'onnx',

    async create(): Promise<ModelAdapter> {
      // @ts-expect-error - optional peer dependency, resolved at runtime inside worker
      const ort = await import('onnxruntime-web');

      return {
        name: 'onnx',

        estimateMemoryMB(_task: string, config: Record<string, unknown>): number {
          return (config.estimatedMemoryMB as number | undefined) ?? 50;
        },

        async load(
          _task: string,
          config: Record<string, unknown>,
          device: Device,
          onProgress: (event: LoadProgressEvent) => void,
        ): Promise<LoadedModel> {
          const modelUrl = config.model as string;

          onProgress({ loaded: 0, phase: 'downloading', total: 0 });

          const executionProviders = device === 'webgpu'
            ? ['webgpu', 'wasm'] as const
            : ['wasm'] as const;

          const session: InferenceSession = await ort.InferenceSession.create(modelUrl, {
            executionProviders,
            graphOptimizationLevel: 'all',
          });

          onProgress({ loaded: 1, phase: 'done', total: 1 });

          return {
            instance: session,
            memoryMB: (config.estimatedMemoryMB as number | undefined) ?? 50,
          };
        },

        async run(model: LoadedModel, input: unknown, _options?: unknown): Promise<unknown> {
          const session = model.instance as InferenceSession;
          const { feeds, outputNames } = input as OnnxInput;

          const results = await session.run(feeds, outputNames);
          return results;
        },

        async stream(
          model: LoadedModel,
          input: unknown,
          onChunk: (chunk: unknown) => void,
          options?: unknown,
        ): Promise<void> {
          // ONNX Runtime Web doesn't natively support streaming inference.
          // Run full inference and emit the result as a single chunk.
          const session = model.instance as InferenceSession;
          const { feeds, outputNames } = input as OnnxInput;
          const result = await session.run(feeds, outputNames, options);
          onChunk(result);
        },

        async unload(model: LoadedModel): Promise<void> {
          const session = model.instance as InferenceSession;
          await session.release?.();
        },
      };
    },
  };
}
