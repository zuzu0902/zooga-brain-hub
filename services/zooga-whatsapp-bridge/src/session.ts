/**
 * Single-session WhatsApp Web manager for the Alex Personal identity.
 *
 * Auth state lives ONLY under SESSION_DIR (Baileys multi-file auth state).
 * The QR code is kept in memory with a short TTL and never persisted.
 * Session files are removed only by the explicit operator logout endpoint.
 */
import { mkdirSync, rmSync } from "node:fs";
import baileys, { DisconnectReason } from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import { log } from "./logger.js";
import { QrStore } from "./qr-store.js";
import {
  backoffDelayMs,
  categorizeDisconnect,
  sanitizeGroups,
  sanitizeStatus,
  type DisconnectCategory,
  type SanitizedGroup,
  type SanitizedStatus,
  type SessionState,
} from "./session-state.js";

const { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = baileys as any;

const silentLogger: any = {
  level: "silent",
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  child: () => silentLogger,
};

export type SessionManagerOptions = {
  sessionDir: string;
  qrTtlMs: number;
  serviceVersion: string;
  maxReconnectAttempts?: number;
};

export class WhatsAppSessionManager {
  private sock: any = null;
  private state: SessionState = "not_configured";
  private lastConnectedAt: string | null = null;
  private lastDisconnectCategory: DisconnectCategory = "none";
  private reconnectAttempts = 0;
  private starting: Promise<void> | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private readonly qr: QrStore;

  constructor(private readonly opts: SessionManagerOptions) {
    this.qr = new QrStore(opts.qrTtlMs);
  }

  status(): SanitizedStatus {
    return sanitizeStatus(
      {
        state: this.state,
        lastConnectedAt: this.lastConnectedAt,
        lastDisconnectCategory: this.lastDisconnectCategory,
        qrAvailable: this.qr.available(),
        reconnectAttempts: this.reconnectAttempts,
      },
      this.opts.serviceVersion,
    );
  }

  /** Short-lived QR payload for the admin UI. Memory only. */
  currentQr(): { qr_text: string; qr_data_url: string | null; expires_in_ms: number } | null {
    const snap = this.qr.get();
    if (!snap) return null;
    return {
      qr_text: snap.text,
      qr_data_url: snap.dataUrl,
      expires_in_ms: Math.max(0, snap.expiresAt - Date.now()),
    };
  }

  async connect(): Promise<SanitizedStatus> {
    if (this.state === "connected" && this.sock) return this.status();
    if (!this.starting) {
      this.starting = this.start().finally(() => {
        this.starting = null;
      });
    }
    await this.starting;
    return this.status();
  }

  private async start(): Promise<void> {
    mkdirSync(this.opts.sessionDir, { recursive: true });
    this.state = "connecting";
    log.info("session_start");

    const { state, saveCreds } = await useMultiFileAuthState(this.opts.sessionDir);
    let version: unknown = undefined;
    try {
      version = (await fetchLatestBaileysVersion()).version;
    } catch {
      version = undefined;
    }

    this.sock = makeWASocket({
      auth: state,
      logger: silentLogger,
      browser: ["Zooga OS Bridge", "Chrome", "1.0.0"],
      syncFullHistory: false,
      markOnlineOnConnect: false,
      ...(version ? { version } : {}),
    });

    this.sock.ev.on("creds.update", saveCreds);
    this.sock.ev.on("connection.update", (update: any) => {
      void this.onConnectionUpdate(update);
    });
  }

  private async onConnectionUpdate(update: any): Promise<void> {
    const { connection, lastDisconnect, qr } = update ?? {};

    if (qr) {
      let dataUrl: string | null = null;
      try {
        dataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
      } catch {
        dataUrl = null;
      }
      this.qr.set(qr, dataUrl);
      this.state = "waiting_for_qr";
      log.info("qr_refreshed");
      return;
    }

    if (connection === "open") {
      this.qr.clear();
      this.state = "connected";
      this.lastConnectedAt = new Date().toISOString();
      this.lastDisconnectCategory = "none";
      this.reconnectAttempts = 0;
      log.info("session_connected");
      return;
    }

    if (connection === "connecting") {
      if (this.state !== "waiting_for_qr") this.state = "connecting";
      return;
    }

    if (connection === "close") {
      this.qr.clear();
      const statusCode =
        lastDisconnect?.error?.output?.statusCode ?? lastDisconnect?.error?.output?.payload?.statusCode ?? null;
      const category = categorizeDisconnect(statusCode);
      this.lastDisconnectCategory = category;
      this.sock = null;

      if (category === "logged_out") {
        // Session is invalid but files are preserved until the operator logs out.
        this.state = "error";
        log.warn("session_logged_out_remote");
        return;
      }

      this.state = "disconnected";
      log.warn("session_closed", { category });
      const max = this.opts.maxReconnectAttempts ?? 6;
      if (category === "transient" || category === "restart_required" || category === "unknown") {
        if (this.reconnectAttempts >= max) {
          this.state = "error";
          log.error("session_reconnect_exhausted", { attempts: this.reconnectAttempts });
          return;
        }
        this.reconnectAttempts += 1;
        const delay = backoffDelayMs(this.reconnectAttempts);
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => {
          void this.connect().catch(() => {
            this.state = "error";
          });
        }, delay);
      }
    }
  }

  /** Graceful socket close. Auth files are preserved. */
  async disconnect(): Promise<SanitizedStatus> {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    try {
      this.sock?.end?.(undefined);
    } catch {
      // ignore
    }
    this.sock = null;
    this.qr.clear();
    this.state = "disconnected";
    log.info("session_disconnected_by_operator");
    return this.status();
  }

  /** Destructive: revoke on WhatsApp first, then remove local auth files. */
  async logout(): Promise<SanitizedStatus> {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    let revoked = false;
    try {
      await this.sock?.logout?.();
      revoked = true;
    } catch {
      revoked = false;
    }
    try {
      this.sock?.end?.(undefined);
    } catch {
      // ignore
    }
    this.sock = null;
    this.qr.clear();
    if (revoked) {
      rmSync(this.opts.sessionDir, { recursive: true, force: true });
      log.warn("session_files_cleared");
    } else {
      log.warn("session_logout_revoke_failed_files_preserved");
    }
    this.state = "not_configured";
    this.lastDisconnectCategory = "logged_out";
    this.reconnectAttempts = 0;
    return this.status();
  }

  async listGroups(): Promise<SanitizedGroup[]> {
    if (this.state !== "connected" || !this.sock) throw new Error("not_connected");
    const raw = await this.sock.groupFetchAllParticipating();
    return sanitizeGroups(raw, this.sock?.user?.id ?? null);
  }

  async sendGroupText(chatId: string, text: string): Promise<{ message_id: string | null; timestamp: number | null }> {
    if (this.state !== "connected" || !this.sock) throw new Error("not_connected");
    const res = await this.sock.sendMessage(chatId, { text });
    return { message_id: res?.key?.id ?? null, timestamp: Number(res?.messageTimestamp ?? 0) || null };
  }

  async sendGroupImage(
    chatId: string,
    buffer: Buffer,
    caption: string,
  ): Promise<{ message_id: string | null; timestamp: number | null }> {
    if (this.state !== "connected" || !this.sock) throw new Error("not_connected");
    const res = await this.sock.sendMessage(chatId, { image: buffer, caption });
    return { message_id: res?.key?.id ?? null, timestamp: Number(res?.messageTimestamp ?? 0) || null };
  }

  get isConnected(): boolean {
    return this.state === "connected";
  }

  /** DisconnectReason is re-exported for operators reading the code. */
  static readonly reasons = DisconnectReason;
}
