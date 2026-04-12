import './shared.css';
import inferisWorkerUrl from './inferis.worker.ts?worker&url';
import { createPool } from 'inferis-ml';
import { transformersAdapter } from 'inferis-ml/adapters/transformers';
import type { Device, ModelHandle } from 'inferis-ml';

const workerUrl = inferisWorkerUrl;

const dropzone = document.getElementById('dropzone') as HTMLDivElement;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const previewImg = document.getElementById('preview-img') as HTMLImageElement;
const classifyBtn = document.getElementById('classify-btn') as HTMLButtonElement;
const progressSection = document.getElementById('progress-section') as HTMLDivElement;
const progressFill = document.getElementById('progress-fill') as HTMLDivElement;
const progressMsg = document.getElementById('progress-msg') as HTMLSpanElement;
const progressFile = document.getElementById('progress-file') as HTMLSpanElement;
const activeDevicePill = document.getElementById('active-device-pill') as HTMLSpanElement;
const modelStateBadge = document.getElementById('model-state-badge') as HTMLSpanElement;
const inferenceTime = document.getElementById('inference-time') as HTMLSpanElement;
const resultCard = document.getElementById('result-card') as HTMLDivElement;
const resultList = document.getElementById('result-list') as HTMLUListElement;
const statusText = document.getElementById('status-text') as HTMLParagraphElement;
const unloadBtn = document.getElementById('unload-btn') as HTMLButtonElement;
const deviceHint = document.getElementById('device-hint') as HTMLSpanElement;
const webgpuBtn = document.getElementById('webgpu-btn') as HTMLButtonElement;
const deviceBtns = document.querySelectorAll<HTMLButtonElement>('.device-btn');

type Classification = Array<{ label: string; score: number }>;

let model: ModelHandle<Classification> | null = null;
let unsubscribeState: (() => void) | null = null;
let currentObjectUrl: string | null = null;
let busy = false;
let selectedDevice: Device = 'wasm';

function setStateBadge(state: string): void {
  modelStateBadge.textContent = state;
  modelStateBadge.dataset['state'] = state;
}

async function initDeviceToggle(): Promise<void> {
  const { createPool: cp } = await import('inferis-ml');
  const tempPool = await cp({ adapter: transformersAdapter(), workerUrl });
  const caps = tempPool.capabilities();
  await tempPool.terminate();

  if (!caps.webgpu.supported) {
    webgpuBtn.disabled = true;
    deviceHint.textContent = 'WebGPU not supported in this browser';
  }
}

async function disposeModel(): Promise<void> {
  if (!model) return;
  unsubscribeState?.();
  unsubscribeState = null;
  await model.dispose();
  model = null;
  unloadBtn.hidden = true;
  modelStateBadge.textContent = '';
  delete modelStateBadge.dataset['state'];
  activeDevicePill.textContent = '';
}

deviceBtns.forEach((btn) => {
  btn.addEventListener('click', async () => {
    if (btn.disabled || btn.classList.contains('active')) return;
    deviceBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedDevice = btn.dataset['device'] as Device;
    await disposeModel();
    resultCard.hidden = true;
    statusText.textContent = '';
  });
});

unloadBtn.addEventListener('click', async () => {
  unloadBtn.disabled = true;
  await disposeModel();
  resultCard.hidden = true;
  statusText.textContent = '';
  unloadBtn.disabled = false;
});

initDeviceToggle();

function formatBytes(n: number): string {
  if (n === 0) return '0 B';
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function loadFile(file: File): void {
  if (!file.type.startsWith('image/')) return;

  if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
  currentObjectUrl = URL.createObjectURL(file);

  previewImg.src = currentObjectUrl;
  previewImg.hidden = false;
  classifyBtn.disabled = false;
  resultCard.hidden = true;
  statusText.textContent = '';
}

dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('drag-over');
});

dropzone.addEventListener('dragleave', () => {
  dropzone.classList.remove('drag-over');
});

dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('drag-over');
  const file = e.dataTransfer?.files[0];
  if (file) loadFile(file);
});

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) loadFile(file);
});

classifyBtn.addEventListener('click', async () => {
  if (busy || !currentObjectUrl) return;

  busy = true;
  classifyBtn.disabled = true;
  resultCard.hidden = true;
  statusText.textContent = '';

  try {
    if (!model) {
      progressSection.hidden = false;
      progressFill.classList.add('indeterminate');
      progressMsg.textContent = 'Loading model…';
      progressFile.textContent = '';

      const pool = await createPool({
        adapter: transformersAdapter(),
        defaultDevice: selectedDevice,
        workerUrl,
      });

      model = await pool.load<Classification>('image-classification', {
        model: 'Xenova/vit-base-patch16-224',
        onProgress: (event) => {
          progressFill.classList.remove('indeterminate');
          const pct = event.total > 0 ? (event.loaded / event.total) * 100 : 0;
          progressFill.style.width = `${pct}%`;
          progressMsg.textContent = event.phase;
          progressFile.textContent = event.total > 0
            ? `${formatBytes(event.loaded)} / ${formatBytes(event.total)}`
            : '';
        },
      });

      progressFill.style.width = '100%';
      progressMsg.textContent = 'Model ready';
      activeDevicePill.textContent = `Running on ${model.device.toUpperCase()}`;
      setStateBadge(model.state);
      unsubscribeState = model.onStateChange((state) => {
        setStateBadge(state);
        if (state === 'disposed') {
          unloadBtn.hidden = true;
        }
      });
      unloadBtn.hidden = false;
    }

    statusText.textContent = 'Classifying…';

    const imageUrl = currentObjectUrl;
    const t0 = performance.now();
    const results = await model.run(imageUrl, { topk: 5 } as unknown as import('inferis-ml').InferenceOptions);
    const elapsed = performance.now() - t0;
    const list = Array.isArray(results) ? results : [results as { label: string; score: number }];

    resultList.innerHTML = '';
    for (const item of list as Classification) {
      const pct = Math.round(item.score * 100);
      const li = document.createElement('li');
      li.className = 'result-item';
      li.innerHTML = `
        <div class="result-row">
          <span class="result-name">${item.label}</span>
          <span class="result-pct">${pct}%</span>
        </div>
        <div class="result-track">
          <div class="result-bar" style="width: ${pct}%"></div>
        </div>
      `;
      resultList.appendChild(li);
    }

    inferenceTime.textContent = elapsed < 1000
      ? `${Math.round(elapsed)} ms`
      : `${(elapsed / 1000).toFixed(2)} s`;
    resultCard.hidden = false;
    statusText.textContent = '';
  }
  catch (err: unknown) {
    statusText.textContent = String(err);
    statusText.classList.add('error');
  }
  finally {
    busy = false;
    classifyBtn.disabled = false;
  }
});
