import './shared.css';
import inferisWorkerUrl from './inferis.worker.ts?worker&url';
import { createPool } from 'inferis';
import { transformersAdapter } from 'inferis/adapters/transformers';
import type { ModelHandle } from 'inferis';

const workerUrl = inferisWorkerUrl;

const textarea = document.getElementById('text-input') as HTMLTextAreaElement;
const analyzeBtn = document.getElementById('analyze-btn') as HTMLButtonElement;
const progressSection = document.getElementById('progress-section') as HTMLDivElement;
const progressFill = document.getElementById('progress-fill') as HTMLDivElement;
const progressMsg = document.getElementById('progress-msg') as HTMLSpanElement;
const progressFile = document.getElementById('progress-file') as HTMLSpanElement;
const resultCard = document.getElementById('result-card') as HTMLDivElement;
const sentIcon = document.getElementById('sent-icon') as HTMLDivElement;
const sentLabel = document.getElementById('sent-label') as HTMLDivElement;
const sentScore = document.getElementById('sent-score') as HTMLDivElement;
const sentBar = document.getElementById('sent-bar') as HTMLDivElement;
const statusText = document.getElementById('status-text') as HTMLParagraphElement;

type ClassificationResult = Array<{ label: string; score: number }>;

let model: ModelHandle<ClassificationResult> | null = null;
let busy = false;

function formatBytes(n: number): string {
  if (n === 0) return '0 B';
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

analyzeBtn.addEventListener('click', async () => {
  if (busy) return;
  const text = textarea.value.trim();
  if (!text) return;

  busy = true;
  analyzeBtn.disabled = true;
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

      model = await pool.load<ClassificationResult>('text-classification', {
        dtype: 'fp32',
        model: 'Xenova/distilbert-base-uncased-finetuned-sst-2-english',
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

    statusText.textContent = 'Analyzing…';

    const result = await model.run(text);
    const top = Array.isArray(result) ? result[0] : (result as ClassificationResult)[0];
    const label = (top.label as string).toUpperCase();
    const score = top.score as number;
    const pct = Math.round(score * 100);

    const isPositive = label === 'POSITIVE';
    sentIcon.textContent = isPositive ? '😊' : '😞';
    sentLabel.textContent = isPositive ? 'Positive' : 'Negative';
    sentLabel.style.color = isPositive ? '#10b981' : '#ef4444';
    sentScore.textContent = `Confidence: ${pct}%`;
    sentBar.style.width = `${pct}%`;
    sentBar.style.background = isPositive ? '#10b981' : '#ef4444';

    resultCard.hidden = false;
    statusText.textContent = '';
  }
  catch (err: unknown) {
    statusText.textContent = String(err);
    statusText.classList.add('error');
  }
  finally {
    busy = false;
    analyzeBtn.disabled = false;
  }
});
