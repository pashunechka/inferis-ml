import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import kleur from 'kleur';
import { getOptions } from './prompts.js';
import { scaffold } from './scaffold.js';

const args = process.argv.slice(2);
const flags: Record<string, string> = {};
let projectName: string | undefined;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg.startsWith('--')) {
    const key = arg.slice(2);
    flags[key] = args[++i] ?? '';
  } else if (!projectName) {
    projectName = arg;
  }
}

async function main(): Promise<void> {
  console.log();
  console.log(kleur.bold('create-inferis-app'));
  console.log();

  const options = await getOptions(projectName, flags);
  const targetDir = resolve(process.cwd(), options.projectName);

  if (existsSync(targetDir)) {
    console.log(kleur.red(`Directory ${options.projectName} already exists.`));
    process.exit(1);
  }

  scaffold(targetDir, options);

  console.log();
  console.log(kleur.green('Done!') + ' Project created at ' + kleur.bold(options.projectName));
  console.log();

  const pm = options.packageManager;
  const runCmd = pm === 'npm' ? 'npm run' : pm;

  console.log('  ' + kleur.dim('$') + ` cd ${options.projectName}`);
  console.log('  ' + kleur.dim('$') + ` ${pm} install`);
  console.log('  ' + kleur.dim('$') + ` ${runCmd} dev`);
  console.log();
}

main().catch((err) => {
  console.error(kleur.red(String(err)));
  process.exit(1);
});
