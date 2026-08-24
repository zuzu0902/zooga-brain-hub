/** Node HTTP entry point for the ZOOGA WhatsApp Web bridge. */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { loadConfig, SERVICE_VERSION } from "./config.js";
import { IdempotencyLedger } from "./idempotency.js";
import { log } from "./logger.js";
import { SendRateLimiter } from "./rate-limit.js";
import { handleRoute, type RouteRequest } from "./router.js";
import { WhatsAppSessionManager } from "./session.js";

const MAX_BODY_BYTES = 64 * 1024;

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).byteLength;
    if (size > MAX_BODY_BYTES) throw new Error("body_too_large");
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function main() {
  const config = loadConfig();
  const session = new WhatsAppSessionManager({
    sessionDir: config.sessionDir,
    qrTtlMs: config.qrTtlMs,
    serviceVersion: SERVICE_VERSION,
  });
  const ledger = IdempotencyLedger.atDataDir(config.dataDir, config.idempotencyTtlMs);
  const limiter = new SendRateLimiter(config.minSendIntervalMs, config.maxSendsPerMinute);

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://bridge.local");
      const headers: Record<string, string | undefined> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        headers[k.toLowerCase()] = Array.isArray(v) ? v[0] : v;
      }

      if (config.allowedOrigin) res.setHeader("access-control-allow-origin", config.allowedOrigin);
      res.setHeader("cache-control", "no-store");
      res.setHeader("x-content-type-options", "nosniff");

      let body: unknown;
      if (req.method === "POST") {
        try {
          body = await readJsonBody(req);
        } catch {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: false, code: "invalid_body" }));
          return;
        }
      }

      const routeReq: RouteRequest = { method: req.method ?? "GET", path: url.pathname, headers, body };
      try {
        const out = await handleRoute(routeReq, { config, session, ledger, limiter });
        for (const [k, v] of Object.entries(out.headers ?? {})) res.setHeader(k, v);
        res.writeHead(out.status, { "content-type": "application/json" });
        res.end(JSON.stringify(out.body));
        log.info("request", { route: `${routeReq.method} ${url.pathname}`, status: out.status });
      } catch {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, code: "internal_error" }));
        log.error("request_failed", { route: `${routeReq.method} ${url.pathname}` });
      }
    })();
  });

  server.listen(config.port, () => {
    log.info("listening", { port: config.port, version: SERVICE_VERSION });
  });

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      log.info("shutting_down");
      server.close(() => process.exit(0));
    });
  }
}

main();
