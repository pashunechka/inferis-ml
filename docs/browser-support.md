# Browser Support

## Feature Matrix

| Feature | Chrome | Firefox | Safari | Edge | iOS Safari | Android Chrome |
|---------|--------|---------|--------|------|------------|----------------|
| **Web Workers** | 4+ | 3.5+ | 4+ | 12+ | 5+ | 18+ |
| **WebAssembly** | 57+ | 52+ | 11+ | 16+ | 11+ | 57+ |
| **WASM SIMD** | 91+ | 89+ | 16.4+ | 91+ | 16.4+ | 91+ |
| **WASM Threads** | 74+ | 79+ | 14.1+ | 74+ | 14.5+ | 74+ |
| **WebGPU** | 113+ | 141+ | 26+ | 113+ | 26+ | 121+ (ARM) |
| **SharedWorker** (tier 1) | 4+ | 29+ | 16+ | 79+ | — | — |
| **Web Locks** (tier 2) | 69+ | 96+ | 15.4+ | 79+ | 15.4+ | 69+ |
| **BroadcastChannel** (tier 2) | 54+ | 38+ | 15.4+ | 79+ | 15.4+ | 54+ |
| **AbortController** | 66+ | 57+ | 12.1+ | 16+ | 12.2+ | 66+ |

## Minimum Requirements

| Requirement | Coverage |
|-------------|----------|
| Web Workers + WASM (inferis core) | ~97% |
| + WASM SIMD | ~92% |
| + WebGPU | ~70% |
| + SharedWorker (cross-tab tier 1) | ~58% |
| + Web Locks (cross-tab tier 2) | ~96% |

## Graceful Degradation Flow

```
detectCapabilities()
  │
  ├─ WebGPU supported?
  │   ├─ YES → defaultDevice = 'webgpu'
  │   └─ NO  → defaultDevice = 'wasm'
  │
  ├─ crossTab: true?
  │   ├─ SharedWorker available?
  │   │   └─ YES → use SharedWorker (tier 1)
  │   ├─ Web Locks + BroadcastChannel available?
  │   │   └─ YES → use leader election (tier 2)
  │   └─ fallback → per-tab dedicated workers (tier 3)
  │
  └─ WASM SIMD available?
      ├─ YES → ONNX WASM SIMD backend (faster)
      └─ NO  → ONNX WASM baseline backend
```

## Notes by Platform

### iOS Safari

- SharedWorker: **not supported** (any version). Cross-tab coordination uses tier 2 (leader election) from iOS 15.4+.
- WebGPU: available from iOS 26 (Safari 26). Currently requires enabling in developer settings.
- WASM SIMD: available from iOS 16.4+.

### Android Chrome

- SharedWorker: **not supported** in Chrome for Android.
- WebGPU: available from Chrome 121 on ARM/Qualcomm devices. Older or Intel-based Android devices may not support it.
- Falls back to tier 2 cross-tab (leader election) on Chrome 69+.

### Firefox

- WebGPU: available from Firefox 141 on Windows, Firefox 145 on macOS Apple Silicon. Linux and Android in progress.
- SharedWorker: available from Firefox 29+.

### Safari on macOS

- WebGPU: available from Safari 26 (macOS Tahoe).
- SharedWorker: available from Safari 16+.

## Polyfills

inferis does not include polyfills. If you need to target older browsers:

- **AbortController**: use `abortcontroller-polyfill` for Safari < 12.1
- **BroadcastChannel**: use `broadcastchannel-polyfill` for older Safari
- **WebAssembly**: no polyfill available — WebAssembly is a hard requirement

## Feature Detection in Your App

```typescript
import { detectCapabilities } from 'inferis-ml';

const caps = await detectCapabilities();

// Show degraded UI on unsupported browsers
if (!caps.wasm.supported) {
  showUnsupportedBanner();
  return;
}

// Inform users about GPU acceleration
if (caps.webgpu.supported) {
  showBadge('GPU accelerated');
} else {
  showBadge('CPU mode');
}

// Warn about potential tab memory usage
if (!caps.sharedWorker && !caps.webLocks) {
  showWarning('Each tab will load the model independently');
}
```
