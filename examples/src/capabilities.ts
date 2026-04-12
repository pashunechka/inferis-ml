import './shared.css';
import { detectCapabilities } from 'inferis-ml';
import type { CapabilityReport } from 'inferis-ml';

const grid = document.getElementById('grid') as HTMLDivElement;
const status = document.getElementById('status') as HTMLParagraphElement;

status.textContent = 'Detecting browser capabilities…';

detectCapabilities().then((caps: CapabilityReport) => {
  status.textContent = '';
  renderCaps(caps);
}).catch((err: unknown) => {
  status.textContent = String(err);
  status.classList.add('error');
});

interface CapEntry {
  name: string;
  val: string;
  sub?: string;
  kind: 'yes' | 'no' | 'info';
}

function renderCaps(caps: CapabilityReport): void {
  const entries: CapEntry[] = [
    {
      kind: caps.webgpu.supported ? 'yes' : 'no',
      name: 'WebGPU',
      sub: caps.webgpu.supported
        ? (caps.webgpu as { adapter?: { name?: string } }).adapter?.name ?? 'adapter detected'
        : 'not available',
      val: caps.webgpu.supported ? 'Supported' : 'Not supported',
    },
    {
      kind: caps.wasm.simd ? 'yes' : 'no',
      name: 'WASM SIMD',
      sub: caps.wasm.simd ? 'vectorized ops' : 'scalar fallback',
      val: caps.wasm.simd ? 'Enabled' : 'Disabled',
    },
    {
      kind: caps.wasm.threads ? 'yes' : 'no',
      name: 'WASM Threads',
      sub: caps.wasm.threads ? 'parallel execution' : 'single-threaded',
      val: caps.wasm.threads ? 'Enabled' : 'Disabled',
    },
    {
      kind: caps.sharedWorker ? 'yes' : 'no',
      name: 'SharedWorker',
      sub: caps.sharedWorker ? 'cross-tab sharing' : 'per-tab only',
      val: caps.sharedWorker ? 'Available' : 'Not available',
    },
    {
      kind: caps.broadcastChannel ? 'yes' : 'no',
      name: 'BroadcastChannel',
      sub: caps.broadcastChannel ? 'inter-tab messaging' : 'unavailable',
      val: caps.broadcastChannel ? 'Available' : 'Not available',
    },
    {
      kind: 'info',
      name: 'CPU Cores',
      sub: 'for worker pool sizing',
      val: String(caps.hardwareConcurrency),
    },
    {
      kind: caps.webgpu.supported ? 'yes' : 'info',
      name: 'Inferred Device',
      sub: caps.webgpu.supported ? 'GPU acceleration' : 'WASM fallback',
      val: caps.webgpu.supported ? 'WebGPU' : 'WASM',
    },
    {
      kind: caps.sharedWorker ? 'yes' : 'info',
      name: 'Cross-tab Mode',
      sub: caps.sharedWorker ? 'one model per N tabs' : 'per-tab fallback',
      val: caps.sharedWorker ? 'SharedWorker' : 'Dedicated',
    },
  ];

  for (const entry of entries) {
    const card = document.createElement('div');
    card.className = `cap-card ${entry.kind}`;
    card.innerHTML = `
      <div class="cap-name">${entry.name}</div>
      <div class="cap-val">${entry.val}</div>
      ${entry.sub ? `<div class="cap-sub">${entry.sub}</div>` : ''}
    `;
    grid.appendChild(card);
  }
}
