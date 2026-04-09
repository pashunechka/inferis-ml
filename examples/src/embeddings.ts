import './shared.css';
import { createPool } from 'inferis';
import { transformersAdapter } from 'inferis/adapters/transformers';
import type { ModelHandle } from 'inferis';

const workerUrl = new URL('./inferis.worker.ts', import.meta.url);

const textA = document.getElementById('text-a') as HTMLTextAreaElement;
const textB = document.getElementById('text-b') as HTMLTextAreaElement;
const compareBtn = document.getElementById('compare-btn') as HTMLButtonElement;
const progressSection = document.getElementById('progress-section') as HTMLDivElement;
const progressFill = document.getElementById('progress-fill') as HTMLDivElement;
const progressMsg = document.getElementById('progress-msg') as HTMLSpanElement;
const progressFile = document.getElementById('progress-file') as HTMLSpanElement;
const resultCard = document.getElementById('result-card') as HTMLDivElement;
const simScore = document.getElementById('sim-score') as HTMLDivElement;
const simFill = document.getElementById('sim-fill') as HTMLDivElement;
const simLabel = document.getElementById('sim-label') as HTMLDivElement;
const simHint = document.getElementById('sim-hint') as HTMLDivElement;
const statusText = document.getElementById('status-text') as HTMLParagraphElement;

type Embedding = { data: ArrayLike<number>; dims: number[] };

let model: ModelHandle<Embedding> | null = null;
let busy = false;

function cosine(a: Float32Array | number[], b: Float32Array | number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a as number[])[i] * (b as number[])[i];
  }
  return Math.max(-1, Math.min(1, dot));
}

function formatBytes(n: number): string {
  if (n === 0) return '0 B';
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function interpretScore(s: number): { label: string; color: string } {
  if (s >= 0.9) return { color: '#10b981', label: 'Very similar' };
  if (s >= 0.7) return { color: '#6366f1', label: 'Somewhat similar' };
  if (s >= 0.45) return { color: '#f59e0b', label: 'Loosely related' };
  return { color: '#9ca3af', label: 'Different topics' };
}

compareBtn.addEventListener('click', async () => {
  if (busy) return;
  const a = textA.value.trim();
  const b = textB.value.trim();
  if (!a || !b) return;

  busy = true;
  compareBtn.disabled = true;
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
        workerUrl,
      });

      model = await pool.load<Embedding>('feature-extraction', {
        dtype: 'fp32',
        model: 'mixedbread-ai/mxbai-embed-xsmall-v1',
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
    }

    statusText.textContent = 'Computing embeddings…';

    const pipeOpts = { normalize: true, pooling: 'mean' } as unknown as import('inferis').InferenceOptions;
    const resA = await model.run(a, pipeOpts);
    const resB = await model.run(b, pipeOpts);

    const embA = Array.from(resA.data);
    const embB = Array.from(resB.data);
    const score = cosine(embA, embB);
    const pct = Math.round(score * 100);
    const { label, color } = interpretScore(score);

    simScore.textContent = `${pct}%`;
    simScore.style.color = color;
    simFill.style.width = `${pct}%`;
    simFill.style.background = color;
    simLabel.textContent = label;
    simLabel.style.color = color;
    simHint.textContent = `Cosine similarity: ${score.toFixed(4)}  ·  Embedding dim: ${embA.length}`;

    resultCard.hidden = false;
    statusText.textContent = '';
  }
  catch (err: unknown) {
    statusText.textContent = String(err);
    statusText.classList.add('error');
  }
  finally {
    busy = false;
    compareBtn.disabled = false;
  }
});
