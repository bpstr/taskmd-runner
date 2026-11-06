import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { lock } from 'proper-lockfile';

export const taskLease = (tasks: string) => path.join(tasks, '.taskmd-runner.lease');
export const taskRegistryLease = (tasks: string) => path.join(tasks, '.taskmd-runner.registry.lease');
const STALE = 30_000;
const UPDATE = 10_000;
interface Owner { token: string; prefixes: string[]; updated: number; }
interface Registry { version: 1; owners: Owner[]; }
const conflict = () => new Error('Another runner owns this task directory or an overlapping task prefix');
const within = (parent: string, child: string) => {
  const relative = path.relative(parent, child);
  return !relative || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
};
const overlaps = (a: string[], b: string[]) => !a.length || !b.length || a.some(x => b.some(y => within(x, y) || within(y, x)));

/** Serialize registry mutations separately from the shared, legacy-visible sentinel. */
async function mutate<T>(tasks: string, fn: () => T): Promise<T> {
  let compromised: Error | undefined;
  const release = await lock(taskRegistryLease(tasks), { realpath: false, lockfilePath: taskRegistryLease(tasks), stale: STALE, update: UPDATE,
    retries: { retries: 20, minTimeout: 25, maxTimeout: 100 }, onCompromised: error => { compromised = error; } });
  try { const result = fn(); if (compromised) throw compromised; return result; }
  finally { await release(); }
}
function readRegistry(tasks: string): Registry | undefined {
  const directory = taskLease(tasks);
  if (!fs.existsSync(directory)) return undefined;
  if (!fs.lstatSync(directory).isDirectory()) throw new Error('Runner lease must be a physical directory');
  const file = path.join(directory, 'owners.json');
  if (!fs.existsSync(file)) {
    // An empty directory belongs to the old whole-store protocol. Never replace
    // a live legacy owner; only its documented stale interval permits recovery.
    if (Date.now() - fs.statSync(directory).mtimeMs <= STALE) throw conflict();
    fs.rmdirSync(directory); // Nonempty/changed legacy leases fail closed.
    return undefined;
  }
  const registry = JSON.parse(fs.readFileSync(file, 'utf8')) as Registry;
  if (registry.version !== 1 || !Array.isArray(registry.owners) || registry.owners.some(owner =>
    typeof owner.token !== 'string' || !Array.isArray(owner.prefixes) || owner.prefixes.some(prefix => typeof prefix !== 'string') || !Number.isFinite(owner.updated)))
    throw new Error('Invalid runner lease registry; preserve it for operator reconciliation');
  return registry;
}
function writeRegistry(tasks: string, registry: Registry) {
  const directory = taskLease(tasks);
  const temporary = path.join(directory, 'owners-' + randomUUID() + '.tmp');
  fs.writeFileSync(temporary, JSON.stringify(registry) + '\n', { flag: 'wx' });
  fs.renameSync(temporary, path.join(directory, 'owners.json'));
  const now = new Date(); fs.utimesSync(directory, now, now);
}

/** Disjoint canonical task prefixes may coexist; no prefixes means exclusive. */
export async function acquireTaskLock(tasks: string, onCompromised: (error: Error) => void, prefixes: string[] = []) {
  tasks = fs.realpathSync(tasks);
  const scopes = [...new Set(prefixes.map(prefix => {
    const resolved = path.resolve(prefix);
    let existing = resolved;
    while (!fs.existsSync(existing) && path.dirname(existing) !== existing) existing = path.dirname(existing);
    if (fs.realpathSync(existing) !== existing || !within(tasks, resolved) || resolved === tasks)
      throw new Error('Lock scope must be a canonical subtree of the task directory');
    return resolved;
  }))];
  const token = randomUUID();
  await mutate(tasks, () => {
    const registry = readRegistry(tasks) ?? { version: 1, owners: [] };
    registry.owners = registry.owners.filter(owner => Date.now() - owner.updated <= STALE);
    if (registry.owners.some(owner => overlaps(scopes, owner.prefixes))) throw conflict();
    if (!fs.existsSync(taskLease(tasks))) fs.mkdirSync(taskLease(tasks));
    registry.owners.push({ token, prefixes: scopes, updated: Date.now() });
    writeRegistry(tasks, registry);
  });
  let released = false;
  let failed = false;
  let update: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (released || failed || update) return;
    update = mutate(tasks, () => {
      const registry = readRegistry(tasks);
      const owner = registry?.owners.find(entry => entry.token === token);
      if (!registry || !owner || Date.now() - owner.updated > STALE) throw new Error('Runner task lease was lost or expired');
      owner.updated = Date.now(); writeRegistry(tasks, registry);
    }).catch(error => { if (!released) { failed = true; clearInterval(timer); onCompromised(error); } }).finally(() => { update = undefined; });
  }, UPDATE);
  timer.unref();
  return async () => {
    if (released) return;
    released = true; clearInterval(timer); await update;
    await mutate(tasks, () => {
      const registry = readRegistry(tasks);
      if (!registry) return;
      registry.owners = registry.owners.filter(owner => owner.token !== token && Date.now() - owner.updated <= STALE);
      if (registry.owners.length) writeRegistry(tasks, registry);
      else {
        fs.unlinkSync(path.join(taskLease(tasks), 'owners.json'));
        fs.rmdirSync(taskLease(tasks));
      }
    });
  };
}
