import fs from 'node:fs';
import path from 'node:path';
import { command } from './process.js';

export const notificationEvents = ['runner.blocked', 'runner.needs_attention', 'runner.stuck', 'runner.turn_limit_reached', 'runner.completed'] as const;
export type NotificationEvent = typeof notificationEvents[number];
export interface NotificationOptions { notify: 'attention' | 'off'; notifyOn: NotificationEvent[] }
export function notificationCommand(platform = process.platform, env = process.env): string {
  const name = platform === 'darwin' ? 'terminal-notifier' : 'notify-send';
  const candidates = (env.PATH || '').split(path.delimiter).filter(Boolean).map(dir => path.join(dir, name));
  if (platform === 'darwin') candidates.push('/opt/homebrew/bin/terminal-notifier', '/usr/local/bin/terminal-notifier');
  for (const file of candidates) { try { fs.accessSync(file, fs.constants.X_OK); return file; } catch {} }
  return name;
}
export type Delivery = (event: NotificationEvent, project: string, task?: string) => Promise<string>;
export class Notifications {
  private submitted = new Set<string>();
  private deliveries: { event: string; task?: string; result: string; at: string }[] = [];
  constructor(private options: NotificationOptions, private file: string, private deliver: Delivery = desktopNotification) {}
  async send(event: NotificationEvent, project: string, task?: string) {
    const attention = ['runner.blocked', 'runner.needs_attention', 'runner.stuck'].includes(event);
    if (this.options.notify === 'off' || (!attention && !this.options.notifyOn.includes(event))) return;
    const key = JSON.stringify([event, project, task]);
    if (this.submitted.has(key)) return;
    let result: string;
    try { result = await this.deliver(event, project, task); } catch { result = 'delivery_failed'; }
    if (result === 'submitted') this.submitted.add(key);
    else console.warn(`Desktop notifications: ${result}; inspect ${this.file}.`);
    this.deliveries.push({ event, task, result, at: new Date().toISOString() });
    try { fs.writeFileSync(this.file, JSON.stringify({ version: 1, deliveries: this.deliveries.slice(-32) }, null, 2) + '\n'); }
    catch { console.warn('Desktop notifications: notification_state_write_failed'); }
  }
  async sendForReason(reason: string, project: string, task?: string) {
    const event: NotificationEvent = reason === 'round_limit' ? 'runner.turn_limit_reached'
      : reason === 'empty' ? 'runner.completed' : reason === 'no_progress' ? 'runner.stuck'
      : reason === 'no_ready_tasks' || reason === 'unmet_dependency' ? 'runner.blocked' : 'runner.needs_attention';
    await this.send(event, project, task);
  }
}
const clean = (text: string) => text.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 240);
export async function desktopNotification(event: NotificationEvent, project: string, task?: string): Promise<string> {
  const title = event === 'runner.stuck' ? 'Taskmd Runner is stuck'
    : event === 'runner.blocked' ? 'Taskmd Runner is blocked'
    : event === 'runner.completed' ? 'Taskmd Runner completed'
    : event === 'runner.turn_limit_reached' ? 'Taskmd Runner reached its round limit' : 'Taskmd Runner needs attention';
  const message = clean(`${path.basename(project)}${task ? ': ' + task : ''}. Inspect the run summary.`);
  if (process.platform !== 'darwin' && !(process.platform === 'linux' && (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) && process.env.DBUS_SESSION_BUS_ADDRESS)) return 'backend_unavailable';
  const args = process.platform === 'darwin' ? ['-title', title, '-message', message, '-group', 'taskmd-runner'] : [title, message];
  try { await command(notificationCommand(), args, { cwd: process.cwd(), timeoutMs: 3000 }); return 'submitted'; }
  catch (error) {
    const message = String(error);
    return message.includes('ENOENT') ? 'backend_unavailable' : message.includes('exit 3:') && process.platform === 'darwin' ? 'permission_denied' : message.includes('timed out') ? 'delivery_timeout' : 'delivery_failed';
  }
}
export async function requestNotificationPermission(signal?: AbortSignal): Promise<number> {
  if (process.platform !== 'darwin') { console.log('On Linux, configure notifications in your desktop session.'); return 1; }
  try {
    await command(notificationCommand(), ['-title', 'Taskmd Runner', '-message', 'Taskmd Runner can now submit desktop alerts.', '-group', 'taskmd-runner-permission'], { cwd: process.cwd(), timeoutMs: 120000, signal });
    console.log('Notification submitted. Focus and system settings determine display.'); return 0;
  } catch (error) {
    if (String(error).includes('exit 3:')) {
      await command('/usr/bin/open', ['x-apple.systempreferences:com.apple.Notifications-Settings.extension'], { cwd: process.cwd(), timeoutMs: 5000, signal }).catch(() => {});
      console.error('Enable terminal-notifier in System Settings > Notifications.');
    } else console.error(String(error));
    return signal?.aborted ? 130 : 1;
  }
}
