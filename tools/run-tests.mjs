import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const mode = process.argv[2] ?? 'all';
if (!['all', 'unit', 'differential'].includes(mode)) throw new Error(`Unknown test mode: ${mode}`);
const directories = mode === 'unit' ? ['compiler'] : mode === 'differential' ? ['differential'] : ['compiler', 'differential'];
const files = directories.flatMap(dir => readdirSync(`dist/tests/${dir}`).filter(name => name.endsWith('.test.js'))
  .sort().map(name => `dist/tests/${dir}/${name}`));
const child = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
if (child.error) throw child.error;
process.exit(child.status ?? 1);
