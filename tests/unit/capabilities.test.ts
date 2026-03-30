import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCapabilitiesCache, detectCapabilities } from '../../src/core/capabilities.js';

beforeEach(() => {
  clearCapabilitiesCache();
  vi.stubGlobal('navigator', undefined);
  vi.stubGlobal('SharedWorker', undefined);
  vi.stubGlobal('BroadcastChannel', undefined);
});

afterEach(() => {
  clearCapabilitiesCache();
  vi.unstubAllGlobals();
});

describe('detectCapabilities', () => {
  it('returns wasm not supported when WebAssembly is absent', async () => {
    vi.stubGlobal('WebAssembly', undefined);
    const caps = await detectCapabilities();
    expect(caps.wasm.supported).toBe(false);
    expect(caps.wasm.simd).toBe(false);
    expect(caps.wasm.threads).toBe(false);
  });

  it('returns webgpu not supported when navigator is absent', async () => {
    vi.stubGlobal('WebAssembly', { validate: () => false });
    const caps = await detectCapabilities();
    expect(caps.webgpu.supported).toBe(false);
    expect(caps.webgpu.adapter).toBeNull();
    expect(caps.webgpu.limits).toBeNull();
    expect(caps.webgpu.isFallback).toBe(false);
  });

  it('returns webgpu not supported when navigator.gpu is absent', async () => {
    vi.stubGlobal('WebAssembly', { validate: () => false });
    vi.stubGlobal('navigator', { hardwareConcurrency: 4 });
    const caps = await detectCapabilities();
    expect(caps.webgpu.supported).toBe(false);
  });

  it('returns webgpu not supported when navigator.gpu is null', async () => {
    vi.stubGlobal('WebAssembly', { validate: () => false });
    vi.stubGlobal('navigator', { gpu: null, hardwareConcurrency: 4 });
    const caps = await detectCapabilities();
    expect(caps.webgpu.supported).toBe(false);
  });

  it('returns webgpu not supported when requestAdapter returns null', async () => {
    vi.stubGlobal('WebAssembly', { validate: () => false });
    vi.stubGlobal('navigator', {
      gpu: { requestAdapter: async () => null },
      hardwareConcurrency: 4,
    });
    const caps = await detectCapabilities();
    expect(caps.webgpu.supported).toBe(false);
  });

  it('returns webgpu supported with full adapter info', async () => {
    vi.stubGlobal('WebAssembly', { validate: () => true });
    vi.stubGlobal('navigator', {
      gpu: {
        requestAdapter: async () => ({
          isFallbackAdapter: false,
          limits: { maxBufferSize: 1000, maxStorageBufferBindingSize: 500 },
          requestAdapterInfo: async () => ({
            architecture: 'turing',
            description: 'NVIDIA',
            device: '3090',
            vendor: 'nvidia',
          }),
        }),
      },
      hardwareConcurrency: 8,
      locks: {},
    });
    const caps = await detectCapabilities();
    expect(caps.webgpu.supported).toBe(true);
    expect(caps.webgpu.adapter?.vendor).toBe('nvidia');
    expect(caps.webgpu.adapter?.architecture).toBe('turing');
    expect(caps.webgpu.limits?.maxBufferSize).toBe(1000);
    expect(caps.webgpu.isFallback).toBe(false);
    expect(caps.hardwareConcurrency).toBe(8);
    expect(caps.webLocks).toBe(true);
    expect(caps.wasm.supported).toBe(true);
    expect(caps.wasm.simd).toBe(true);
  });

  it('returns webgpu supported when requestAdapterInfo is absent', async () => {
    vi.stubGlobal('WebAssembly', { validate: () => false });
    vi.stubGlobal('navigator', {
      gpu: {
        requestAdapter: async () => ({
          isFallbackAdapter: true,
          limits: { maxBufferSize: 0, maxStorageBufferBindingSize: 0 },
          requestAdapterInfo: undefined,
        }),
      },
      hardwareConcurrency: 2,
    });
    const caps = await detectCapabilities();
    expect(caps.webgpu.supported).toBe(true);
    expect(caps.webgpu.isFallback).toBe(true);
    expect(caps.webgpu.adapter?.vendor).toBe('');
  });

  it('returns webgpu not supported when requestAdapter throws', async () => {
    vi.stubGlobal('WebAssembly', { validate: () => false });
    vi.stubGlobal('navigator', {
      gpu: { requestAdapter: async () => { throw new Error('GPU error'); } },
      hardwareConcurrency: 2,
    });
    const caps = await detectCapabilities();
    expect(caps.webgpu.supported).toBe(false);
  });

  it('caches result on second call', async () => {
    vi.stubGlobal('WebAssembly', { validate: () => false });
    const caps1 = await detectCapabilities();
    const caps2 = await detectCapabilities();
    expect(caps1).toBe(caps2);
  });

  it('clearCapabilitiesCache resets cache', async () => {
    vi.stubGlobal('WebAssembly', { validate: () => false });
    const caps1 = await detectCapabilities();
    clearCapabilitiesCache();
    const caps2 = await detectCapabilities();
    expect(caps1).not.toBe(caps2);
  });

  it('detects SharedWorker availability', async () => {
    vi.stubGlobal('WebAssembly', { validate: () => false });
    vi.stubGlobal('SharedWorker', class {});
    const caps = await detectCapabilities();
    expect(caps.sharedWorker).toBe(true);
  });

  it('detects BroadcastChannel availability', async () => {
    vi.stubGlobal('WebAssembly', { validate: () => false });
    vi.stubGlobal('BroadcastChannel', class {});
    const caps = await detectCapabilities();
    expect(caps.broadcastChannel).toBe(true);
  });

  it('hardwareConcurrency defaults to 1 without navigator', async () => {
    vi.stubGlobal('WebAssembly', { validate: () => false });
    vi.stubGlobal('navigator', undefined);
    const caps = await detectCapabilities();
    expect(caps.hardwareConcurrency).toBe(1);
  });

  it('hardwareConcurrency defaults to 1 when undefined on navigator', async () => {
    vi.stubGlobal('WebAssembly', { validate: () => false });
    vi.stubGlobal('navigator', { hardwareConcurrency: undefined });
    const caps = await detectCapabilities();
    expect(caps.hardwareConcurrency).toBe(1);
  });
});
