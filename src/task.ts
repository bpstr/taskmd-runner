import fs from 'node:fs';
import { isScalar, isSeq, parseDocument } from 'yaml';

export const now = () => new Date().toISOString();
export function readTask(file: string): { meta: Record<string, any>; body: string } {
  const match = fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n').match(/^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/);
  if (!match) throw new Error(`Invalid frontmatter: ${file}`);
  const document = parseDocument(match[1]);
  if (document.errors.length) throw document.errors[0];
  const meta = document.toJS();
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new Error(`Invalid task metadata: ${file}`);
  // taskmd identifiers are strings, even when its YAML writer leaves 084 unquoted.
  // Use scalar source text before a numeric conversion can discard zeros or precision.
  const identifier = (node: unknown, value: unknown) => isScalar(node)
    ? typeof node.value === 'string' ? node.value : node.source ?? String(node.value)
    : value;
  for (const key of ['id', 'parent']) if (key in meta) meta[key] = identifier(document.get(key, true), meta[key]);
  const dependencies = document.get('dependencies', true);
  if (isSeq(dependencies)) meta.dependencies = dependencies.items.map((node, index) => identifier(node, meta.dependencies[index]));
  return { meta, body: '\n' + match[2] };
}
export function contract(file: string) {
  const { meta, body } = readTask(file);
  for (const key of ['status', 'started_at', 'completed_at', 'updated_at', 'pr']) delete meta[key];
  return { meta, scope: body.split('\n## Progress')[0].replace(/^(\s*- )\[[xX ]\]/gm, '$1[ ]') };
}
export function checks(file: string): [number, number] {
  const body = readTask(file).body.split('\n## Progress')[0];
  return [(body.match(/^\s*- \[[xX]\]/gm) || []).length, (body.match(/^\s*- \[ \]/gm) || []).length];
}
export const verifiedCount = (file: string) => (readTask(file).body.match(/^\s*- \[[xX]\]/gm) || []).length;
export function progress(file: string, message: string) {
  let text = fs.readFileSync(file, 'utf8');
  if (!text.includes('\n## Progress')) text = text.trimEnd() + '\n\n## Progress\n';
  fs.writeFileSync(file, text.trimEnd() + `\n\n${now()} — ${message}\n`);
}
const runMarker = /^<!-- taskmd-runner runs: (\d+) -->$/gm;
export function taskRuns(file: string): number {
  const journal = readTask(file).body.split('\n## Progress').slice(1).join('\n## Progress');
  const markers = [...journal.matchAll(runMarker)];
  const count = markers.length ? Number(markers[0][1]) : 0;
  if (markers.length > 1 || !Number.isSafeInteger(count)) throw new Error('Invalid task run counter');
  return count;
}
export function setTaskRuns(file: string, count: number) {
  let text = fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
  if (!text.includes('\n## Progress')) text = text.trimEnd() + '\n\n## Progress\n';
  const at = text.indexOf('\n## Progress');
  const journal = text.slice(at).replace(runMarker, '').trimEnd();
  fs.writeFileSync(file, text.slice(0, at) + journal + `\n\n<!-- taskmd-runner runs: ${count} -->\n`);
}
export function taskContext(file: string): string {
  const text = fs.readFileSync(file, 'utf8');
  const at = text.indexOf('\n## Progress');
  if (at < 0 || Buffer.byteLength(text.slice(at + 12)) <= 4096) return text;
  const paragraphs: string[] = []; let size = 0;
  for (const paragraph of text.slice(at + 12).trim().split('\n\n').reverse()) {
    const cost = Buffer.byteLength(paragraph) + 2;
    if (size + cost > 4096) {
      if (!paragraphs.length) paragraphs.push(Buffer.from(paragraph).subarray(-4094).toString('utf8').replace(/^\uFFFD+/, ''));
      break;
    }
    paragraphs.push(paragraph); size += cost;
  }
  return text.slice(0, at) + '\n## Progress (latest checkpoint; earlier history remains in the task file)\n\n' + paragraphs.reverse().join('\n\n');
}
