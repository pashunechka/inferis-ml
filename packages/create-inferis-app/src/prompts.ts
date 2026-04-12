import { existsSync } from 'node:fs';
import prompts from 'prompts';

export interface Options {
  projectName: string;
  adapter: 'transformers' | 'web-llm';
  packageManager: 'npm' | 'pnpm' | 'yarn';
}

function detectPackageManager(): 'npm' | 'pnpm' | 'yarn' {
  if (existsSync('pnpm-lock.yaml')) return 'pnpm';
  if (existsSync('yarn.lock')) return 'yarn';
  return 'npm';
}

export async function getOptions(
  nameArg: string | undefined,
  flags: Record<string, string>,
): Promise<Options> {
  const adapter = flags['adapter'] as Options['adapter'] | undefined;
  const pm = flags['pm'] as Options['packageManager'] | undefined;
  const isCI = adapter && pm && nameArg;

  if (isCI) {
    return {
      projectName: nameArg,
      adapter: adapter === 'web-llm' ? 'web-llm' : 'transformers',
      packageManager: (['npm', 'pnpm', 'yarn'] as const).includes(pm as 'npm') ? pm as Options['packageManager'] : 'npm',
    };
  }

  const questions: prompts.PromptObject[] = [];

  if (!nameArg) {
    questions.push({
      type: 'text',
      name: 'projectName',
      message: 'Project name',
      initial: 'my-inferis-app',
    });
  }

  if (!adapter) {
    questions.push({
      type: 'select',
      name: 'adapter',
      message: 'Adapter',
      choices: [
        { title: 'transformers  (WASM, works everywhere)', value: 'transformers' },
        { title: 'web-llm       (WebGPU, LLM chat)', value: 'web-llm' },
      ],
    });
  }

  if (!pm) {
    questions.push({
      type: 'select',
      name: 'packageManager',
      message: 'Package manager',
      choices: [
        { title: 'npm', value: 'npm' },
        { title: 'pnpm', value: 'pnpm' },
        { title: 'yarn', value: 'yarn' },
      ],
      initial: ['npm', 'pnpm', 'yarn'].indexOf(detectPackageManager()),
    });
  }

  const answers = questions.length > 0
    ? await prompts(questions, { onCancel: () => { process.exit(0); } })
    : {};

  return {
    projectName: nameArg ?? answers.projectName,
    adapter: adapter ?? answers.adapter ?? 'transformers',
    packageManager: pm as Options['packageManager'] ?? answers.packageManager ?? 'npm',
  };
}
