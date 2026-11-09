import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { command } from './process.js';

interface Repository { path: string; branch: string; remote: string; remoteRef: string; upstream: string; head: string }
export interface GitConflict { repository: string; files: string[]; folder: string; phase: string }
type Resolver = (conflict: GitConflict) => Promise<void>;
const split = (value: string) => value.split('\0').filter(Boolean);
const inside = (root: string, file: string) => file === root || file.startsWith(root + path.sep);
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

/** Sync only explicitly selected, initially clean checkouts. Never stash or force. */
export class GitSync {
  repositories: Repository[] = [];
  events: Record<string, unknown>[] = [];
  error?: string;
  private serial = 0;
  constructor(private project: string, private paths: string[], private excluded: string[],
    private directory: string, private signal?: AbortSignal, private resolver?: Resolver,
    private integrationBranch?: string, private syncUpstream = true) {}

  private async git(root: string, ...args: string[]) {
    try {
      return await command('git', ['--literal-pathspecs', ...args], { cwd: root, signal: this.signal,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_MERGE_AUTOEDIT: 'no' }, timeoutMs: 60_000 });
    } catch (error) {
      throw new Error(String(error instanceof Error ? error.message : error).replace(/(https?:\/\/)[^\s/@]+@/g, '$1[redacted]@'));
    }
  }
  private save() {
    fs.mkdirSync(this.directory, { recursive: true });
    fs.writeFileSync(path.join(this.directory, 'git-sync.json'), JSON.stringify(this.state(), null, 2) + '\n');
  }
  state() { return { repositories: this.repositories, events: this.events, upstream_sync: this.syncUpstream,
    ...(this.integrationBranch ? { integration_branch: this.integrationBranch } : {}), ...(this.error ? { error: this.error } : {}) }; }
  private event(event: string, repository: string, detail: Record<string, unknown> = {}) {
    this.events.push({ event, repository, at: new Date().toISOString(), ...detail }); this.save();
  }
  failed(error: unknown) { this.error = error instanceof Error ? error.message : String(error); this.save(); }
  private ignored(repo: string, file: string) { return this.excluded.some(root => inside(root, path.resolve(repo, file))); }
  private async changed(repo: string) {
    const [staged, unstaged, untracked] = await Promise.all([
      this.git(repo, 'diff', '--cached', '--name-only', '--no-renames', '-z'),
      this.git(repo, 'diff', '--name-only', '--no-renames', '-z'),
      this.git(repo, 'ls-files', '--others', '--exclude-standard', '-z'),
    ]);
    return [...new Set([...split(staged), ...split(unstaged), ...split(untracked)])].filter(file => !this.ignored(repo, file)).sort();
  }
  private async operation(repo: string) {
    for (const name of ['MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'sequencer']) {
      const file = path.resolve(repo, (await this.git(repo, 'rev-parse', '--git-path', name)).trim());
      if (fs.existsSync(file)) throw new Error(`Unfinished Git operation (${name}) in ${repo}; reconcile it before starting`);
    }
  }
  private async identity(repo: Repository) {
    const branch = (await this.git(repo.path, 'symbolic-ref', '--short', 'HEAD')).trim();
    const head = (await this.git(repo.path, 'rev-parse', 'HEAD')).trim();
    if (branch !== repo.branch || head !== repo.head) throw new Error(`Git branch or HEAD changed outside the controller in ${repo.path}`);
  }
  async initialize() {
    for (const selected of this.paths.length ? this.paths : [this.project]) {
      const cwd = fs.realpathSync(path.resolve(this.project, selected));
      let root: string;
      try { root = fs.realpathSync((await this.git(cwd, 'rev-parse', '--show-toplevel')).trim()); }
      catch { throw new Error(`Git sync needs a repository at ${cwd}; use repeatable --git-repo paths for a workspace`); }
      if (this.repositories.some(repo => repo.path === root)) continue;
      if (this.repositories.some(repo => inside(repo.path, root) || inside(root, repo.path))) throw new Error('Git sync requires separate, non-nested repository roots');
      await this.operation(root);
      const dirty = await this.changed(root);
      if (dirty.length) throw new Error(`Git sync requires a clean checkout in ${root}: ${dirty.slice(0, 8).join(', ')}`);
      const branch = (await this.git(root, 'symbolic-ref', '--short', 'HEAD')).trim();
      let upstream = '', remote = '', remoteRef = '';
      if (this.syncUpstream) {
        upstream = (await this.git(root, 'rev-parse', '--symbolic-full-name', '@{upstream}')).trim();
        remote = (await this.git(root, 'config', '--get', `branch.${branch}.remote`)).trim();
        remoteRef = (await this.git(root, 'config', '--get', `branch.${branch}.merge`)).trim();
        if (!remote || remote === '.' || remote.startsWith('-') || !remoteRef.startsWith('refs/heads/')) throw new Error(`Git sync needs a configured remote tracking branch in ${root}`);
      }
      if (this.integrationBranch !== undefined) {
        if (!this.integrationBranch || this.integrationBranch.startsWith('-')) throw new Error('Invalid local integration branch');
        await this.git(root, 'check-ref-format', `refs/heads/${this.integrationBranch}`);
        await this.git(root, 'show-ref', '--verify', `refs/heads/${this.integrationBranch}`);
      }
      await this.git(root, 'var', 'GIT_AUTHOR_IDENT'); await this.git(root, 'var', 'GIT_COMMITTER_IDENT');
      this.repositories.push({ path: root, branch, remote, remoteRef, upstream, head: (await this.git(root, 'rev-parse', 'HEAD')).trim() });
    }
    this.save();
  }
  async requirePath(directory: string) {
    const root = fs.realpathSync((await this.git(directory, 'rev-parse', '--show-toplevel')).trim());
    if (!this.repositories.some(repo => repo.path === root)) throw new Error(`Include the task directory's owning checkout with --git-repo ${root}`);
  }
  private async outside(repo: Repository, conflicts: string[]) {
    const files = (await this.changed(repo.path)).filter(file => !conflicts.includes(file));
    const entries = files.map(file => {
      const full = path.join(repo.path, file);
      try {
        const stat = fs.lstatSync(full);
        return [file, stat.mode, digest(stat.isSymbolicLink() ? fs.readlinkSync(full) : fs.readFileSync(full))];
      } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [file, 'deleted']; throw error; }
    });
    const index = files.length ? await this.git(repo.path, 'ls-files', '--stage', '-z', '--', ...files) : '';
    return JSON.stringify({ entries, index });
  }
  private async merge(repo: Repository, phase: string, verify?: () => Promise<void>, target = repo.upstream) {
    await this.identity(repo);
    if ((await this.changed(repo.path)).length) throw new Error(`Git checkout became dirty during synchronization: ${repo.path}`);
    const counts = (await this.git(repo.path, 'rev-list', '--left-right', '--count', `HEAD...${target}`)).trim().split(/\s+/).map(Number);
    if (!counts[1]) return false;
    if (!counts[0]) {
      await this.git(repo.path, 'merge', '--ff-only', '--', target);
      repo.head = (await this.git(repo.path, 'rev-parse', 'HEAD')).trim();
      await verify?.();
      this.event('fast_forward', repo.path, { phase, target, head: repo.head }); return true;
    }
    try { await this.git(repo.path, 'merge', '--no-ff', '--no-commit', '--', target); }
    catch (error) {
      const files = split(await this.git(repo.path, 'diff', '--name-only', '--diff-filter=U', '-z'));
      if (!files.length) throw error;
      this.event('conflict', repo.path, { phase, target, files });
      if (!this.resolver) throw new Error(`Git conflicts in ${repo.path}; reconcile the preserved merge manually. Enable --git-conflicts worker before starting a future clean run for automatic resolution`);
      const mergeHead = (await this.git(repo.path, 'rev-parse', 'MERGE_HEAD')).trim();
      const outside = await this.outside(repo, files);
      const index = await this.git(repo.path, 'ls-files', '--stage', '-z', '--', ...files);
      const folder = path.join(this.directory, 'git-conflicts', String(++this.serial).padStart(3, '0'));
      fs.mkdirSync(folder, { recursive: true });
      await this.resolver({ repository: repo.path, files, phase, folder });
      await this.identity(repo);
      if ((await this.git(repo.path, 'rev-parse', 'MERGE_HEAD')).trim() !== mergeHead || outside !== await this.outside(repo, files)) throw new Error('Conflict worker changed Git history or files outside its conflict scope');
      if (index !== await this.git(repo.path, 'ls-files', '--stage', '-z', '--', ...files)) throw new Error('Conflict worker changed the controller-owned Git index');
      for (const file of files) {
        const full = path.join(repo.path, file);
        if (fs.existsSync(full) && fs.lstatSync(full).isFile() && /^(<<<<<<< |=======\r?$|>>>>>>> )/m.test(fs.readFileSync(full, 'utf8'))) throw new Error(`Conflict markers remain in ${file}`);
      }
      await this.git(repo.path, 'add', '--all', '--', ...files);
      if ((await this.git(repo.path, 'diff', '--name-only', '--diff-filter=U')).trim()) throw new Error('Conflict worker left unresolved index entries');
      this.event('conflict_resolved', repo.path, { phase, files, evidence: folder });
    }
    await verify?.();
    await this.git(repo.path, 'commit', '-m', target === repo.upstream ? 'Merge upstream changes for the next task' : `Merge ${this.integrationBranch} for the next task`);
    repo.head = (await this.git(repo.path, 'rev-parse', 'HEAD')).trim();
    this.event('merge', repo.path, { phase, target, head: repo.head }); return true;
  }
  async before(round: number) {
    // Preflight all checkouts before changing any of them.
    for (const repo of this.repositories) {
      await this.identity(repo); await this.operation(repo.path);
      if ((await this.changed(repo.path)).length) throw new Error(`Git checkout became dirty between rounds: ${repo.path}`);
      if (this.integrationBranch) await this.git(repo.path, 'show-ref', '--verify', `refs/heads/${this.integrationBranch}`);
    }
    for (const repo of this.repositories) {
      if (this.syncUpstream) {
        await this.git(repo.path, 'fetch', '--no-tags', '--', repo.remote);
        await this.merge(repo, `before round ${round}`);
      }
      if (this.integrationBranch) await this.merge(repo, `integration before round ${round}`, undefined, `refs/heads/${this.integrationBranch}`);
      this.event('ready', repo.path, { round, head: repo.head });
    }
  }
  async after(round: number, id: string, status: string, verify: () => Promise<void>) {
    for (const repo of this.repositories) {
      await this.identity(repo); await this.operation(repo.path);
      if ((await this.git(repo.path, 'diff', '--cached', '--name-only')).trim()) throw new Error(`Task worker changed the controller-owned Git index in ${repo.path}`);
    }
    for (const repo of this.repositories) {
      await this.identity(repo);
      const files = await this.changed(repo.path);
      if (files.length) {
        await this.git(repo.path, 'add', '--all', '--', ...files);
        if ((await this.git(repo.path, 'diff', '--cached', '--name-only')).trim()) {
          const subject = status === 'completed' ? `Complete task ${id}` : `Save progress on task ${id}`;
          await this.git(repo.path, 'commit', '-m', subject);
          repo.head = (await this.git(repo.path, 'rev-parse', 'HEAD')).trim();
          this.event('commit', repo.path, { round, task_id: id, head: repo.head, files });
        }
      }
      if (!this.syncUpstream) {
        if ((await this.changed(repo.path)).length) throw new Error(`Uncommitted changes remain after local checkpoint in ${repo.path}`);
        this.event('checkpointed', repo.path, { round, head: repo.head }); continue;
      }
      const upstream = (await this.git(repo.path, 'rev-parse', repo.upstream)).trim();
      try { await this.git(repo.path, 'push', '--', repo.remote, `HEAD:${repo.remoteRef}`); }
      catch (error) {
        await this.git(repo.path, 'fetch', '--no-tags', '--', repo.remote);
        if ((await this.git(repo.path, 'rev-parse', repo.upstream)).trim() === upstream) throw error;
        await this.merge(repo, `publish round ${round}`, verify);
        await this.git(repo.path, 'push', '--', repo.remote, `HEAD:${repo.remoteRef}`);
      }
      if ((await this.changed(repo.path)).length) throw new Error(`Uncommitted changes remain after Git sync in ${repo.path}`);
      this.event('pushed', repo.path, { round, head: repo.head });
    }
  }
}
