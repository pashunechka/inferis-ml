import './shared.css';
import inferisWorkerUrl from './inferis.worker.ts?worker&url';
import { createPool } from 'inferis-ml';
import { transformersAdapter } from 'inferis-ml/adapters/transformers';
import type { ModelHandle } from 'inferis-ml';

const workerUrl = inferisWorkerUrl;

const analyzeBtn = document.getElementById('analyze-btn') as HTMLButtonElement;
const nerLegend = document.getElementById('ner-legend') as HTMLDivElement;
const nerMeta = document.getElementById('ner-meta') as HTMLDivElement;
const nerOutput = document.getElementById('ner-output') as HTMLDivElement;
const progressFill = document.getElementById('progress-fill') as HTMLDivElement;
const progressFile = document.getElementById('progress-file') as HTMLSpanElement;
const progressMsg = document.getElementById('progress-msg') as HTMLSpanElement;
const progressSection = document.getElementById('progress-section') as HTMLDivElement;
const resultCard = document.getElementById('result-card') as HTMLDivElement;
const statusText = document.getElementById('status-text') as HTMLParagraphElement;
const textarea = document.getElementById('text-input') as HTMLTextAreaElement;

type NerToken = {
  entity: string;
  index: number;
  score: number;
  word: string;
};

type NerResult = NerToken[];

type EntityType = 'LOC' | 'MISC' | 'ORG' | 'PER';

type EntitySpan = {
  end: number;
  label: EntityType;
  score: number;
  start: number;
  text: string;
};

const ENTITY_COLORS: Record<EntityType, string> = {
  LOC: '#10b981',
  MISC: '#9ca3af',
  ORG: '#f59e0b',
  PER: '#818cf8',
};

const ENTITY_LABELS: Record<EntityType, string> = {
  LOC: 'Location',
  MISC: 'Misc',
  ORG: 'Organization',
  PER: 'Person',
};

const LEGEND_ITEMS: EntityType[] = ['LOC', 'MISC', 'ORG', 'PER'];

let busy = false;
let model: ModelHandle<NerResult> | null = null;

function formatBytes(n: number): string {
  if (n === 0) return '0 B';
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function isValidEntityType(s: string): s is EntityType {
  return s === 'PER' || s === 'ORG' || s === 'LOC' || s === 'MISC';
}

function reconstructWord(tokens: NerToken[]): string {
  let word = '';
  for (const token of tokens) {
    if (token.word.startsWith('##')) {
      word += token.word.slice(2);
    } else if (word === '') {
      word = token.word;
    } else {
      word += ' ' + token.word;
    }
  }
  return word;
}

function toSpans(tokens: NerToken[], sourceText: string): EntitySpan[] {
  const spans: EntitySpan[] = [];
  let cursor = 0;
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i];

    if (!token.entity.startsWith('B-')) {
      i++;
      continue;
    }

    const typeStr = token.entity.slice(2).toUpperCase();
    if (!isValidEntityType(typeStr)) {
      i++;
      continue;
    }

    const group: NerToken[] = [token];
    let scoreSum = token.score;
    let j = i + 1;

    while (j < tokens.length && tokens[j].entity === `I-${typeStr}`) {
      group.push(tokens[j]);
      scoreSum += tokens[j].score;
      j++;
    }

    const word = reconstructWord(group);
    const start = sourceText.indexOf(word, cursor);

    if (start !== -1) {
      const end = start + word.length;
      spans.push({
        end,
        label: typeStr,
        score: scoreSum / group.length,
        start,
        text: word,
      });
      cursor = end;
    }

    i = j;
  }

  return spans;
}

function renderOutput(text: string, spans: EntitySpan[]): void {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const parts: string[] = [];
  let cursor = 0;

  for (const span of sorted) {
    if (span.start > cursor) {
      parts.push(escapeHtml(text.slice(cursor, span.start)));
    }

    const color = ENTITY_COLORS[span.label];
    const label = ENTITY_LABELS[span.label];
    const pct = Math.round(span.score * 100);

    parts.push(
      `<mark class="ner-mark" style="--ner-color:${color}" title="${label} · ${pct}%">` +
        escapeHtml(span.text) +
        `<span class="ner-badge">${span.label}</span>` +
      `</mark>`,
    );

    cursor = span.end;
  }

  if (cursor < text.length) {
    parts.push(escapeHtml(text.slice(cursor)));
  }

  nerOutput.innerHTML = parts.join('');
}

function renderLegend(presentTypes: Set<EntityType>): void {
  const items = LEGEND_ITEMS.filter((t) => presentTypes.has(t));
  nerLegend.innerHTML = items
    .map(
      (t) =>
        `<span class="ner-legend-item">` +
          `<span class="ner-legend-dot" style="background:${ENTITY_COLORS[t]}"></span>` +
          ENTITY_LABELS[t] +
        `</span>`,
    )
    .join('');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const style = document.createElement('style');
style.textContent = `
.ner-output {
  font-size: 15px;
  line-height: 2;
  color: var(--muted);
  word-break: break-word;
  margin-bottom: 18px;
}
.ner-mark {
  position: relative;
  background: color-mix(in srgb, var(--ner-color) 18%, transparent);
  border-radius: 3px;
  padding: 1px 2px;
  border-bottom: 2px solid var(--ner-color);
  color: var(--text);
  cursor: default;
  white-space: nowrap;
}
.ner-badge {
  display: inline-block;
  margin-left: 4px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: var(--ner-color);
  vertical-align: middle;
  line-height: 1;
  padding: 1px 4px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--ner-color) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--ner-color) 35%, transparent);
}
.ner-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin-bottom: 12px;
}
.ner-legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--muted);
}
.ner-legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.ner-meta {
  font-size: 12px;
  color: var(--muted);
}
`;
document.head.appendChild(style);

analyzeBtn.addEventListener('click', async () => {
  if (busy) return;
  const text = textarea.value.trim();
  if (!text) return;

  busy = true;
  analyzeBtn.disabled = true;
  resultCard.hidden = true;
  statusText.textContent = '';
  statusText.classList.remove('error');

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

      model = await pool.load<NerResult>('token-classification', {
        dtype: 'fp32',
        model: 'Xenova/bert-base-NER',
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

    const t0 = performance.now();
    const tokens = await model.run(text);
    const elapsed = performance.now() - t0;

    const spans = toSpans(tokens, text);
    const presentTypes = new Set(spans.map((s) => s.label));

    renderOutput(text, spans);
    renderLegend(presentTypes);

    const entityCount = spans.length;
    nerMeta.textContent = `${entityCount} entit${entityCount === 1 ? 'y' : 'ies'} detected · inference ${elapsed.toFixed(0)} ms`;

    resultCard.hidden = false;
    statusText.textContent = '';
  } catch (err: unknown) {
    statusText.textContent = String(err);
    statusText.classList.add('error');
  } finally {
    busy = false;
    analyzeBtn.disabled = false;
  }
});
