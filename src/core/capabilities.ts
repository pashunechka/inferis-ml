import type { CapabilityReport, WasmCapability, WebGpuCapability } from './types.js';

const WASM_SIMD_PROBE = new Uint8Array([
  0x00,
  0x61,
  0x73,
  0x6D,
  0x01,
  0x00,
  0x00,
  0x00,
  0x01,
  0x05,
  0x01,
  0x60,
  0x00,
  0x01,
  0x7B,
  0x03,
  0x02,
  0x01,
  0x00,
  0x0A,
  0x0A,
  0x01,
  0x08,
  0x00,
  0x41,
  0x00,
  0xFD,
  0x0F,
  0x00,
  0x00,
  0x0B,
]);

const WASM_THREADS_PROBE = new Uint8Array([
  0x00,
  0x61,
  0x73,
  0x6D,
  0x01,
  0x00,
  0x00,
  0x00,
  0x01,
  0x04,
  0x01,
  0x60,
  0x00,
  0x00,
  0x03,
  0x02,
  0x01,
  0x00,
  0x05,
  0x04,
  0x01,
  0x03,
  0x01,
  0x01,
  0x0A,
  0x0B,
  0x01,
  0x09,
  0x00,
  0xFE,
  0x01,
  0x02,
  0x00,
  0x41,
  0x00,
  0x0B,
]);

function detectWasm(): WasmCapability {
  if (typeof WebAssembly === 'undefined') {
    return { simd: false, supported: false, threads: false };
  }
  return {
    simd: WebAssembly.validate(WASM_SIMD_PROBE),
    supported: true,
    threads: WebAssembly.validate(WASM_THREADS_PROBE),
  };
}

async function detectWebGpu(): Promise<WebGpuCapability> {
  if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
    return { adapter: null, isFallback: false, limits: null, supported: false };
  }

  // eslint-disable-next-line ts/no-explicit-any
  const gpu = (navigator as any).gpu;
  if (gpu == null) {
    return { adapter: null, isFallback: false, limits: null, supported: false };
  }

  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) {
      return { adapter: null, isFallback: false, limits: null, supported: false };
    }

    // eslint-disable-next-line ts/no-explicit-any
    const info = await adapter.requestAdapterInfo?.() as any ?? {};
    const isFallback: boolean = adapter.isFallbackAdapter ?? false;

    return {
      adapter: {
        architecture: (info.architecture as string) ?? '',
        description: (info.description as string) ?? '',
        device: (info.device as string) ?? '',
        vendor: (info.vendor as string) ?? '',
      },
      isFallback,
      limits: {
        maxBufferSize: adapter.limits?.maxBufferSize ?? 0,
        maxStorageBufferBindingSize: adapter.limits?.maxStorageBufferBindingSize ?? 0,
      },
      supported: true,
    };
  }
  catch {
    return { adapter: null, isFallback: false, limits: null, supported: false };
  }
}

function detectSharedWorker(): boolean {
  return typeof SharedWorker !== 'undefined';
}

function detectBroadcastChannel(): boolean {
  return typeof BroadcastChannel !== 'undefined';
}

function detectWebLocks(): boolean {
  return typeof navigator !== 'undefined' && 'locks' in navigator;
}

let cachedReport: CapabilityReport | null = null;

/**
 * Detect browser capabilities for AI inference.
 * Result is cached after first call.
 *
 * @example
 * const caps = await detectCapabilities();
 * if (caps.webgpu.supported) {
 *   console.log('GPU vendor:', caps.webgpu.adapter?.vendor);
 * }
 */
export async function detectCapabilities(): Promise<CapabilityReport> {
  if (cachedReport)
    return cachedReport;

  const [webgpu, wasm] = await Promise.all([detectWebGpu(), Promise.resolve(detectWasm())]);

  cachedReport = Object.freeze({
    broadcastChannel: detectBroadcastChannel(),
    hardwareConcurrency: typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency ?? 1) : 1,
    sharedWorker: detectSharedWorker(),
    wasm,
    webgpu,
    webLocks: detectWebLocks(),
  });

  return cachedReport;
}

/** Clear the cached capability report. Useful for testing. */
export function clearCapabilitiesCache(): void {
  cachedReport = null;
}
