import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Share profile inputs, never the session store or other mutable runtime state.
export function isolatedCodexHome(runDir: string): string {
  const source = path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'));
  const home = path.join(runDir, 'codex-home');
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  const inputs = ['config.toml', 'managed_config.toml', 'auth.json', '.credentials.json',
    'AGENTS.md', 'AGENTS.override.md', 'hooks.json', 'rules', 'skills', 'plugins'];
  if (fs.existsSync(source)) inputs.push(...fs.readdirSync(source).filter(name => name.endsWith('.config.toml')));
  for (const name of inputs) {
    const origin = path.join(source, name), target = path.join(home, name);
    if (!fs.existsSync(origin)) continue;
    try { fs.symlinkSync(origin, target, fs.statSync(origin).isDirectory() ? 'junction' : 'file'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  }
  return home;
}
