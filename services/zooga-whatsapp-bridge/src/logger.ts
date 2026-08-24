/**
 * Redacting logger. Never logs phone numbers, JIDs, chat ids, message bodies,
 * QR payloads or session material.
 */
import { SERVICE_NAME } from "./config.js";

const PHONE_RE = /\+?\d[\d\s\-().]{7,}\d/g;
const JID_RE = /[\w.-]+@(?:s\.whatsapp\.net|g\.us|lid|c\.us)/gi;
const SECRETISH_RE = /(?:api[_-]?key|token|secret|password|credential|qr)\s*[:=]\s*\S+/gi;

export function redact(input: unknown): string {
  const raw = typeof input === "string" ? input : safeStringify(input);
  return raw
    .replace(JID_RE, "[jid]")
    .replace(SECRETISH_RE, (m) => `${m.split(/[:=]/)[0]}=[redacted]`)
    .replace(PHONE_RE, "[redacted]")
    .slice(0, 500);
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return "[unserializable]";
  }
}

type Level = "info" | "warn" | "error";

function emit(level: Level, code: string, fields?: Record<string, string | number | boolean>) {
  const line: Record<string, unknown> = {
    svc: SERVICE_NAME,
    level,
    code,
    ts: new Date().toISOString(),
  };
  for (const [k, v] of Object.entries(fields ?? {})) {
    line[k] = typeof v === "string" ? redact(v) : v;
  }
  const out = JSON.stringify(line);
  if (level === "error") console.error(out);
  else if (level === "warn") console.warn(out);
  else console.log(out);
}

export const log = {
  info: (code: string, fields?: Record<string, string | number | boolean>) => emit("info", code, fields),
  warn: (code: string, fields?: Record<string, string | number | boolean>) => emit("warn", code, fields),
  error: (code: string, fields?: Record<string, string | number | boolean>) => emit("error", code, fields),
};
