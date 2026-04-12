# Writing Custom Adapters

## Adapter Architecture

Adapters run **inside the Web Worker**, not on the main thread. The `ModelAdapterFactory` is a lightweight factory object that can be structured-cloned across the thread boundary. The heavy runtime library is dynamically imported inside `create()` — which runs inside the worker.

```
Main Thread                     Web Worker
─────────────────               ─────────────────────────────────
ModelAdapterFactory     →       factory.create()
  .name: 'my-adapter'   →         import('my-heavy-library')
                                    → ModelAdapter instance
                                      .load(), .run(), .stream(), .unload()
```

## Interface

```typescript
interface ModelAdapterFactory {
  readonly name: string;
  create(): Promise<ModelAdapter>;
}

interface ModelAdapter {
  readonly name: string;

  load(
    task: string,
    config: Record<string, unknown>,
    device: 'webgpu' | 'wasm',
    onProgress: (event: { phase: string; loaded: number; total: number }) => void,
  ): Promise<LoadedModel>;

  run(model: LoadedModel, input: unknown, options?: unknown): Promise<unknown>;

  stream(
    model: LoadedModel,
    input: unknown,
    onChunk: (chunk: unknown) => void,
    options?: unknown,
  ): Promise<void>;

  unload(model: LoadedModel): Promise<void>;

  estimateMemoryMB(task: string, config: Record<string, unknown>): number;
}

interface LoadedModel {
  instance: unknown;   // opaque handle (your runtime object)
  memoryMB: number;    // actual memory after load
}
```

## Minimal Example

```typescript
import type { ModelAdapter, ModelAdapterFactory, LoadedModel } from 'inferis-ml';

export function myAdapter(): ModelAdapterFactory {
  return {
    name: 'my-adapter',

    async create(): Promise<ModelAdapter> {
      const { MyRuntime } = await import('my-runtime');

      return {
        name: 'my-adapter',

        estimateMemoryMB(_task, config) {
          return (config.estimatedMemoryMB as number) ?? 50;
        },

        async load(task, config, device, onProgress) {
          onProgress({ phase: 'downloading', loaded: 0, total: 0 });

          const instance = await MyRuntime.load(config.model as string, {
            device,
            onProgress: (p: number) => onProgress({
              loaded: p,
              phase: 'loading',
              total: 1,
            }),
          });

          return { instance, memoryMB: 50 };
        },

        async run(model, input, options) {
          return (model.instance as InstanceType<typeof MyRuntime>).infer(input, options);
        },

        async stream(model, input, onChunk, options) {
          for await (const chunk of (model.instance as InstanceType<typeof MyRuntime>).stream(input, options)) {
            onChunk(chunk);
          }
        },

        async unload(model) {
          await (model.instance as InstanceType<typeof MyRuntime>).dispose();
        },
      };
    },
  };
}
```

## Rules

### 1. Dynamic imports only inside `create()`

```typescript
// WRONG — imports in the factory body run on the main thread
import { MyRuntime } from 'my-runtime';
export function myAdapter() { ... }

// CORRECT — import inside create(), runs in the worker
export function myAdapter(): ModelAdapterFactory {
  return {
    async create() {
      const { MyRuntime } = await import('my-runtime');
      // ...
    }
  };
}
```

### 2. Return structured-cloneable values from `run()`

The output of `run()` and chunks from `stream()` are sent via `postMessage`. They must be [structured-cloneable](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm):

- Plain objects, arrays, strings, numbers: ✓
- `ArrayBuffer`, `TypedArray`: ✓ (transferred, zero-copy)
- `Blob`, `ImageData`: ✓
- Functions, class instances, DOM nodes: ✗

### 3. Always call `unload()` cleanup

GPU buffers are not garbage collected. Always call `GPUBuffer.destroy()` or equivalent in `unload()`:

```typescript
async unload(model: LoadedModel): Promise<void> {
  const engine = model.instance as MyGpuRuntime;
  engine.gpuBuffers.forEach(b => b.destroy());
  engine.gpuDevice?.destroy();
  await engine.dispose();
}
```

### 4. Call `onProgress` during long downloads

```typescript
async load(task, config, device, onProgress) {
  // Use fetch with progress tracking
  const response = await fetch(config.model as string);
  const total = Number(response.headers.get('content-length') ?? 0);
  let loaded = 0;

  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress({ loaded, phase: 'downloading', total });
  }

  // ... create model from chunks
}
```

### 5. `estimateMemoryMB` should be fast

This method is called on the main thread BEFORE spawning a load task, to check budget constraints. Keep it synchronous and fast — just a lookup or simple calculation.

## Adapter for Custom ONNX Model

```typescript
import type { ModelAdapter, ModelAdapterFactory } from 'inferis-ml';

export function customOnnxAdapter(modelUrl: string): ModelAdapterFactory {
  return {
    name: 'custom-onnx',
    async create(): Promise<ModelAdapter> {
      const ort = await import('onnxruntime-web');

      return {
        name: 'custom-onnx',
        estimateMemoryMB: () => 80,

        async load(_task, _config, device, onProgress) {
          onProgress({ loaded: 0, phase: 'loading', total: 0 });
          const session = await ort.InferenceSession.create(modelUrl, {
            executionProviders: device === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm'],
          });
          onProgress({ loaded: 1, phase: 'done', total: 1 });
          return { instance: session, memoryMB: 80 };
        },

        async run(model, input) {
          const session = model.instance as ort.InferenceSession;
          const { feeds } = input as { feeds: Record<string, ort.Tensor> };
          return session.run(feeds);
        },

        async stream(model, input, onChunk, options) {
          onChunk(await this.run(model, input, options));
        },

        async unload(model) {
          await (model.instance as ort.InferenceSession).release();
        },
      };
    },
  };
}
```
