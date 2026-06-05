// TanStack Start SSR worker entry. Do NOT put app/business logic here —
// app-internal server work belongs in createServerFn handlers, and external
// HTTP endpoints belong in src/routes/api/**.
import "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

let serverEntryPromise: Promise<any> | null = null;
async function getServerEntry() {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry");
  }
  return serverEntryPromise;
}

async function normalizeCatastrophicSsrResponse(res: Response): Promise<Response> {
  if (res.status !== 500) return res;
  try {
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("text/html")) return res;
    const text = await res.clone().text();
    if (text && text.trim().length > 0) return res;
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  } catch {
    return res;
  }
}

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      const entry: any = await getServerEntry();
      const handler = entry.default?.fetch ?? entry.fetch;
      const res: Response = await handler(request);
      return await normalizeCatastrophicSsrResponse(res);
    } catch {
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
