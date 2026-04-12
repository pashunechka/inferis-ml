# API Reference

## `createPool(config)`

Creates and initializes a `WorkerPool`. Spawns workers and detects browser capabilities.

```typescript
async function createPool(config: PoolConfig): Promise<WorkerPool>
```

### `PoolConfig`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `adapter` | `ModelAdapterFactory` | **required** | Adapter factory for the AI runtime |
| `workerUrl` | `URL \| string` | auto-resolved | URL to the pre-built worker file |
| `maxWorkers` | `number` | `hardwareConcurrency - 1` | Maximum number of dedicated workers |
| `maxMemoryMB` | `number` | `2048` | Combined memory budget in MB |
| `defaultDevice` | `'webgpu' \| 'wasm' \| 'auto'` | `'auto'` | Inference device. `'auto'` tries WebGPU, falls back to WASM |
| `crossTab` | `boolean` | `false` | Enable cross-tab model deduplication |
| `taskTimeout` | `number` | `120_000` | Per-task timeout in milliseconds |

---

## `WorkerPool`

### `pool.load<TOutput>(task, config)`

Load a model and return a handle. If the model is already loaded (same task + model name), returns the existing handle.

```typescript
load<TOutput = unknown>(task: string, config: ModelLoadConfig): Promise<ModelHandle<TOutput>>
```

### `ModelLoadConfig`

| Field | Type | Description |
|-------|------|-------------|
| `model` | `string` | Model identifier (HuggingFace model ID, URL, etc.) |
| `estimatedMemoryMB` | `number?` | Memory hint for budget planning |
| `onProgress` | `(event: LoadProgressEvent) => void` | Download/load progress callback |
| `...rest` | `unknown` | Adapter-specific config passed through |

### `pool.capabilities()`

Returns detected browser capabilities. Cached after first call.

```typescript
capabilities(): CapabilityReport
```

### `pool.terminate()`

Gracefully terminate all workers and reject all pending tasks.

```typescript
terminate(): Promise<void>
```

---

## `ModelHandle<TOutput>`

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `id` | `string` | Unique model ID: `task:modelName` |
| `state` | `ModelState` | Current lifecycle state |
| `memoryMB` | `number` | Approximate memory usage in MB |
| `device` | `Device` | Resolved inference device: `'webgpu'` or `'wasm'` |

### `model.run(input, options?)`

Run non-streaming inference.

```typescript
run(input: unknown, options?: InferenceOptions): Promise<TOutput>
```

### `model.stream(input, options?)`

Run streaming inference. Returns a `ReadableStream<TOutput>`.

```typescript
stream(input: unknown, options?: InferenceOptions): ReadableStream<TOutput>

// Async iteration:
for await (const chunk of model.stream(input)) { ... }

// Collect all chunks:
import { collectStreamText } from 'inferis-ml';
const text = await collectStreamText(model.stream(input));
```

### `model.dispose()`

Unload the model and free its resources. Waits for any in-flight inference to complete.

```typescript
dispose(): Promise<void>
```

### `model.onStateChange(callback)`

Subscribe to state changes. Returns an unsubscribe function.

```typescript
onStateChange(callback: (state: ModelState) => void): () => void

const unsub = model.onStateChange((state) => {
  console.log('State:', state);
});
unsub(); // unsubscribe
```

---

## `InferenceOptions`

```typescript
interface InferenceOptions {
  signal?: AbortSignal;              // cancel via AbortController
  priority?: 'high' | 'normal' | 'low';  // scheduling priority, default 'normal'
}
```

---

## `ModelState`

```typescript
type ModelState =
  | 'idle'       // registered, not yet loaded
  | 'loading'    // load in progress
  | 'ready'      // loaded, accepting inference
  | 'inferring'  // inference in progress
  | 'unloading'  // dispose in progress
  | 'error'      // load or device error; call dispose() or retry load()
  | 'disposed';  // terminal state; handle is unusable
```

---

## `CapabilityReport`

```typescript
interface CapabilityReport {
  webgpu: {
    supported: boolean;
    adapter: { vendor: string; architecture: string; device: string; description: string } | null;
    limits: { maxBufferSize: number; maxStorageBufferBindingSize: number } | null;
    isFallback: boolean;
  };
  wasm: {
    supported: boolean;
    simd: boolean;
    threads: boolean;
  };
  sharedWorker: boolean;
  broadcastChannel: boolean;
  webLocks: boolean;
  hardwareConcurrency: number;
}
```

---

## `detectCapabilities()`

Detect browser capabilities. Cached after first call.

```typescript
async function detectCapabilities(): Promise<CapabilityReport>
```

---

## Streaming Utilities

### `readableToAsyncIter(stream)`

Convert a `ReadableStream` to an `AsyncIterable`.

```typescript
import { readableToAsyncIter } from 'inferis-ml';
for await (const chunk of readableToAsyncIter(stream)) { ... }
```

### `collectStream(stream)`

Collect all chunks into an array.

```typescript
import { collectStream } from 'inferis-ml';
const chunks = await collectStream(stream);
```

### `collectStreamText(stream)`

Collect all string chunks and join them.

```typescript
import { collectStreamText } from 'inferis-ml';
const text = await collectStreamText(stream);  // ReadableStream<string> → string
```

---

## Errors

All errors extend `InferisError` which extends `Error`.

| Class | Code | When |
|-------|------|------|
| `InferisError` | varies | Base class |
| `ModelLoadError` | `MODEL_LOAD_ERROR` | Adapter `load()` threw |
| `ModelNotReadyError` | `MODEL_NOT_READY` | Inference called when model isn't `ready` |
| `ModelDisposedError` | `MODEL_DISPOSED` | Used after dispose |
| `InferenceError` | `INFERENCE_ERROR` | Adapter `run()` or `stream()` threw |
| `BudgetExceededError` | `BUDGET_EXCEEDED` | Model too large for budget |
| `TaskTimeoutError` | `TASK_TIMEOUT` | Task exceeded `taskTimeout` |
| `WorkerError` | `WORKER_ERROR` | Worker crash |
| `DeviceLostError` | `DEVICE_LOST` | GPU device lost |
| `InvalidStateTransitionError` | `INVALID_STATE_TRANSITION` | Invalid lifecycle transition |

```typescript
import { ModelNotReadyError, BudgetExceededError } from 'inferis-ml';

try {
  await model.run(input);
} catch (e) {
  if (e instanceof ModelNotReadyError) {
    console.log('Model not ready:', e.modelId);
  } else if (e instanceof BudgetExceededError) {
    console.log('Need:', e.requestedMB, 'MB, budget:', e.budgetMB, 'MB');
  }
}
```
