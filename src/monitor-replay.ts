import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { atomicJson } from "./monitor-state.js";
import { probe, type MonitorConfig } from "./monitor-config.js";
import { acquirePublisher } from "./monitor-lock.js";
import { readTask } from "./task.js";

export function taskBlockerResolved(directory: string, id: string, taskPath: string) {
  try {
    const file = path.resolve(directory, taskPath);
    const relative = path.relative(directory, file);
    if (!relative || relative === ".." || relative.startsWith(".." + path.sep) ||
        path.isAbsolute(relative) || fs.realpathSync(file) !== file) return false;
    const { meta } = readTask(file);
    return String(meta.id) === id &&
      ["pending", "in-progress", "in-review", "completed", "cancelled"].includes(meta.status);
  } catch {
    return false;
  }
}

export function resolvedTerminalAttention(state: any) {
  const report = state.terminal ?? state.attentionReceipt;
  if (!report?.run.terminal || !state.taskDirectory || !state.taskBlockers) return null;
  const remaining = report.attention.filter((item: any) => {
    const id = item.task_id;
    const taskPath = id && Object.hasOwn(state.taskBlockers, id) && state.taskBlockers[id];
    return item.category !== "blocker" || !taskPath ||
      !taskBlockerResolved(state.taskDirectory, id, taskPath);
  });
  return remaining.length < report.attention.length ? remaining : null;
}

export function rememberTerminalAttention(state: any, report: any) {
  if (state.taskDirectory && report.attention.some((item: any) =>
    item.category === "blocker" && Object.hasOwn(state.taskBlockers ?? {}, item.task_id))) {
    state.attentionReceipt = { ...report, events: [] };
  } else {
    delete state.attentionReceipt;
  }
}

export async function flushStored(
  config: MonitorConfig,
  file: string,
  taskDirectory?: string,
) {
  const release = acquirePublisher(file);
  if (!release) return false;
  try {
    // Reload under the lock: a publisher may have completed since directory enumeration.
    const state = JSON.parse(fs.readFileSync(file, "utf8"));
    if (
      state.connectionId !== config.connectionId ||
      (state.installationId && state.installationId !== config.installationId)
    )
      return false;
    const attention = !taskDirectory || state.taskDirectory === taskDirectory
      ? resolvedTerminalAttention(state) : null;
    if (attention) {
      const previous = state.terminal ?? state.attentionReceipt;
      state.sequence = Math.max(state.sequence, previous.report_sequence) + 1;
      state.terminal = {
        ...previous, attention, report_sequence: state.sequence, report_id: randomUUID(),
      };
      atomicJson(file, state);
    }
    const base = state.terminal ?? state.replayBase ?? state.initial;
    if (!base || (!state.terminal && !state.events.length)) return false;
    const verified =
      config.verified && config.installationId
        ? { installation_id: config.installationId }
        : await probe(config);
    if (
      state.installationId &&
      state.installationId !== verified.installation_id
    )
      return false;
    const events = [];
    for (const event of state.events.slice(0, 32)) {
      if (
        Buffer.byteLength(
          JSON.stringify({ ...base, events: [...events, event] }),
        ) > 65536
      )
        break;
      events.push(event);
    }
    const report = { ...base, kind: "replay", report_id: randomUUID(), events };
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(report),
      signal: AbortSignal.timeout(4000),
      redirect: "error",
    });
    if (!response.ok) return false;
    const result = await response.json();
    if (result.installation_id !== verified.installation_id) return false;
    const ids = new Set(events.map((e) => e.id));
    state.events = state.events.filter((e: any) => !ids.has(e.id));
    if (state.events.length === 0) {
      if (base.run.terminal) rememberTerminalAttention(state, base);
      delete state.terminal;
      delete state.initial;
      delete state.replayBase;
    }
    atomicJson(file, state);
    return true;
  } catch {
    return false;
  } finally {
    release();
  }
}
