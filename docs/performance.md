# Performance

## WebGPU vs WASM

| Model Type | WebGPU | WASM (SIMD) | Speedup |
|------------|--------|-------------|---------|
| LLM (4-bit quant) | 30–80 tokens/s | 5–15 tokens/s | 4–6x |
| Embedding (MiniLM) | ~50ms | ~200ms | 4x |
| Whisper tiny | ~5s | ~20s | 4x |
| Image classification | ~10ms | ~80ms | 8x |

*Approximate values on M2 MacBook Pro.*

## Memory Budget

### How It Works

Before loading a model, inferis-ml:
1. Asks the adapter for `estimateMemoryMB(task, config)`
2. Checks if `estimatedMB <= budget.availableMB`
3. If not, runs `planEviction()` to find LRU models to unload
4. Evicts them, then loads the new model

```typescript
const pool = await createPool({
  adapter: transformersAdapter(),
  maxMemoryMB: 4096,  // 4GB budget
});
```

### Provide Accurate Estimates

The default estimate is 100 MB for all task types. If you know your model's size, provide it:

```typescript
const model = await pool.load('feature-extraction', {
  model: 'Xenova/all-MiniLM-L6-v2',
  estimatedMemoryMB: 23,  // actual size: ~23MB
});
```

### Monitor Usage

```typescript
const pool = await createPool({ adapter: transformersAdapter() });
const budget = pool._budget;

console.log(`Used: ${budget.allocatedMB}MB / ${budget.totalMB}MB`);
console.log(`Available: ${budget.availableMB}MB`);
console.log(`LRU order:`, budget.lruList);
```

## Worker Pool Sizing

### CPU-bound inference (embeddings, classification)

```typescript
const pool = await createPool({
  adapter: transformersAdapter(),
  maxWorkers: navigator.hardwareConcurrency - 1,  // default
});
```

Use all available cores. Each worker handles one task at a time; parallel workers allow concurrent inference.

### GPU-bound inference (LLMs)

```typescript
const pool = await createPool({
  adapter: webLlmAdapter(),
  maxWorkers: 1,  // GPU has one execution context
  defaultDevice: 'webgpu',
});
```

A single GPU worker is optimal. Multiple GPU workers compete for the same GPU context and hurt throughput.

## Model Affinity

The scheduler tracks which worker has each model loaded. When a new task arrives for model `A`, it's routed to the worker that already has model `A` in memory — avoiding a redundant load.

```
Worker 0: [Model A, Model B]
Worker 1: [Model C]

Task for A → Worker 0 (affinity hit)
Task for D → Worker 1 (least loaded, no affinity)
```

## Concurrent Inference

Multiple inference tasks for the same model can run concurrently on different workers. The scheduler uses a `concurrencyPerWorker` limit (default: 4) to prevent worker overload.

```typescript
// These run concurrently on different workers
const [r1, r2, r3] = await Promise.all([
  model.run('text 1'),
  model.run('text 2'),
  model.run('text 3'),
]);
```

## Streaming Performance

Streaming uses `stream-chunk` postMessages. Each message has ~0.1ms overhead — negligible for LLM token rates (20–100 tokens/s = 10–50ms between tokens).

For binary data (audio, image tensors), use `ArrayBuffer` which is transferred zero-copy:

```typescript
// In your custom adapter's run():
const buffer = new Float32Array(embeddings).buffer;
return buffer;  // transferred to main thread, zero-copy
```

## Warm Start

transformers.js caches model files in the browser's Cache API / IndexedDB. After the first load, subsequent page loads skip the download:

```
First visit:   download (slow) → load → infer
Second visit:  cache hit → load → infer  (much faster)
```

## Profiling

```typescript
const start = performance.now();
await pool.load('feature-extraction', { model: '...' });
console.log(`Model load: ${performance.now() - start}ms`);

const t0 = performance.now();
const result = await model.run(['Hello world']);
console.log(`Inference: ${performance.now() - t0}ms`);
```

For GPU memory profiling, use Chrome DevTools → Memory → WebGPU (Chrome 121+).
