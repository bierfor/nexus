/**
 * In-memory chat for a single Node process (dev / one replica).
 * For production at scale, swap the broker publish for Redis, etc.
 */
import { getChannel } from '@nexus/connect';

const MAX_MESSAGES = 300;
/** @type {{ id: string; nick: string; text: string; ts: number }[]} */
const messages = [];
const channel = getChannel('anon-chat');

/** Strip angle brackets; messages are interpolated as text in the client template. */
function sanitize(s) {
  return String(s).replace(/[<>]/g, '');
}

export function getMessages() {
  return { messages: messages.map((m) => ({ ...m })) };
}

export function appendMessage(nick, text) {
  const n = sanitize(nick).trim().slice(0, 24) || 'Anónimo';
  const t = sanitize(text).trim().slice(0, 500);
  if (!t) return getMessages();

  const ts = Date.now();
  const d = new Date(ts);
  messages.push({
    id: `${ts}-${Math.random().toString(36).slice(2, 9)}`,
    nick: n,
    text: t,
    ts,
    time: d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
  });
  while (messages.length > MAX_MESSAGES) messages.shift();

  const snap = getMessages();
  channel.publish(snap);
  return snap;
}
