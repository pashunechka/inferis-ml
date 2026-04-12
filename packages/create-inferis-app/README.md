# create-inferis-app

Scaffold an [inferis-ml](https://github.com/pashunechka/inferis) project in one command.

## Quick Start

```bash
npm create inferis-app my-app
cd my-app
npm install
npm run dev
```

## Options

| Flag | Description | Values |
|------|-------------|--------|
| `--adapter` | ML runtime | `transformers` (default), `web-llm` |
| `--pm` | Package manager | `npm` (default), `pnpm`, `yarn` |

```bash
npm create inferis-app my-app -- --adapter web-llm --pm pnpm
```

## Templates

| Template | Stack | Description |
|----------|-------|-------------|
| `vite-vanilla` | Vite + TypeScript | Minimal AI app with model loading, inference, and streaming |

## Generated Project Structure

```
my-app/
  index.html
  package.json
  tsconfig.json
  vite.config.ts
  src/
    main.ts         # App logic with model loading and inference
    worker.ts       # Web Worker with registered adapter
    style.css       # Minimal dark theme
```
