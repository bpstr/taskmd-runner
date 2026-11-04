import fs from 'node:fs';
import { parse } from 'yaml';

export const now = () => new Date().toISOString();
export function readTask(file: string): { meta: Record<string, any>; body: string } {
  const match = fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n').match(/^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/);
  if (!match) throw new Error(`Invalid frontmatter: ${file}`);
  const meta = parse(match[1]);
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new Error(`Invalid task metadata: ${file}`);
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
