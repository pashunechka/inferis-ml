import type {
  Device,
  LoadedModel,
  LoadProgressEvent,
  ModelAdapter,
  ModelAdapterFactory,
} from '../core/types.js';

// eslint-disable-next-line ts/no-explicit-any
type MLCEngine = any;

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatInput {
  messages: ChatMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
}

/**
 * Adapter for @mlc-ai/web-llm.
 *
 * @remarks
 * Optimized for LLM text generation with WebGPU acceleration.
 * Streaming is natively supported via the OpenAI-compatible chat API.
 *
 * @example
 * ```ts
 * import { createPool } from 'inferis';
 * import { webLlmAdapter } from 'inferis/adapters/web-llm';
 *
 * const pool = await createPool({
 *   adapter: webLlmAdapter(),
 *   defaultDevice: 'webgpu',
 *   maxWorkers: 1,
 * });
 *
 * const llm = await pool.load<string>('text-generation', {
 *   model: 'Llama-3.1-8B-Instruct-q4f32_1-MLC',
 * });
 *
 * const stream = llm.stream({ messages: [{ role: 'user', content: 'Hello' }] });
 * for await (const token of stream) { ... }
 * ```
 */
export function webLlmAdapter(): ModelAdapterFactory {
  return {
    name: 'web-llm',

    async create(): Promise<ModelAdapter> {
      // @ts-expect-error - optional peer dependency, resolved at runtime inside worker
      const { CreateMLCEngine } = await import('@mlc-ai/web-llm');

      return {
        name: 'web-llm',

        estimateMemoryMB(_task: string, config: Record<string, unknown>): number {
          return (config.estimatedMemoryMB as number | undefined) ?? 2000;
        },

        async load(
          _task: string,
          config: Record<string, unknown>,
          _device: Device,
          onProgress: (event: LoadProgressEvent) => void,
        ): Promise<LoadedModel> {
          const modelId = config.model as string;

          const engine: MLCEngine = await CreateMLCEngine(modelId, {
            initProgressCallback: (info: { progress: number; text: string }) => {
              onProgress({
                loaded: info.progress,
                phase: info.text,
                total: 1,
              });
            },
          });

          return {
            instance: engine,
            memoryMB: (config.estimatedMemoryMB as number | undefined) ?? 2000,
          };
        },

        async run(model: LoadedModel, input: unknown, options?: unknown): Promise<unknown> {
          const engine = model.instance as MLCEngine;
          const chatInput = input as ChatInput;
          const response = await engine.chat.completions.create({
            ...(options as object ?? {}),
            messages: chatInput.messages,
            stream: false,
          });
          return response.choices[0]?.message?.content ?? '';
        },

        async stream(
          model: LoadedModel,
          input: unknown,
          onChunk: (chunk: unknown) => void,
          options?: unknown,
        ): Promise<void> {
          const engine = model.instance as MLCEngine;
          const chatInput = input as ChatInput;

          const asyncChunks = await engine.chat.completions.create({
            ...(options as object ?? {}),
            messages: chatInput.messages,
            stream: true,
          });

          for await (const chunk of asyncChunks) {
            const delta = chunk.choices[0]?.delta?.content;
            if (delta)
              onChunk(delta);
          }
        },

        async unload(model: LoadedModel): Promise<void> {
          const engine = model.instance as MLCEngine;
          await engine.unload?.();
        },
      };
    },
  };
}
