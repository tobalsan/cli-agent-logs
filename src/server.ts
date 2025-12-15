import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { streamSSE } from "hono/streaming";
import { loadConfig, type Root } from "./config";
import { scanAllRoots, scanRoot, getSessionsForRoot, getSessionById } from "./indexer";
import { getParser } from "./parsers";
import { watchAllRoots } from "./watch";

const app = new Hono();

let roots: Root[] = [];

// SSE clients
const sseClients = new Set<(data: string) => void>();

function broadcast(event: { type: string; rootId: string }) {
  const data = JSON.stringify(event);
  for (const send of sseClients) {
    send(data);
  }
}

// API routes
app.get("/api/roots", (c) => {
  return c.json(roots.map((r) => ({ id: r.id, label: r.label })));
});

app.get("/api/roots/:rootId/sessions", (c) => {
  const rootId = c.req.param("rootId");
  const sessions = getSessionsForRoot(rootId);
  return c.json(sessions);
});

app.get("/api/sessions/:sessionId", async (c) => {
  const sessionId = c.req.param("sessionId");
  const meta = getSessionById(sessionId);

  if (!meta) {
    return c.json({ error: "Session not found" }, 404);
  }

  const root = roots.find((r) => r.id === meta.rootId);
  if (!root) {
    return c.json({ error: "Root not found" }, 404);
  }

  const parser = getParser(root.format);
  if (!parser) {
    return c.json({ error: `Unknown format: ${root.format}` }, 400);
  }

  const parsed = await parser(meta.path);
  return c.json(parsed);
});

// SSE endpoint
app.get("/api/events", async (c) => {
  return streamSSE(c, async (stream) => {
    const send = (data: string) => {
      stream.writeSSE({ data });
    };

    sseClients.add(send);

    // Keep connection alive
    const keepAlive = setInterval(() => {
      stream.writeSSE({ data: '{"type":"ping"}' });
    }, 30000);

    // Wait for disconnect
    await new Promise<void>((resolve) => {
      stream.onAbort(() => {
        clearInterval(keepAlive);
        sseClients.delete(send);
        resolve();
      });
    });
  });
});

// SPA fallback for client-side routing
app.get("*", async (c, next) => {
  const path = c.req.path;
  if (path.startsWith("/api/") || path.includes(".")) {
    return next();
  }
  return c.html(await Bun.file("./public/index.html").text());
});

// Static files
app.use("/*", serveStatic({ root: "./public" }));

// Start server
async function main() {
  const config = await loadConfig();
  roots = config.roots;

  console.log("Scanning session folders...");
  await scanAllRoots(roots);
  console.log(`Found sessions in ${roots.length} roots`);

  // Watch for changes
  watchAllRoots(roots, async (rootId) => {
    console.log(`Root ${rootId} changed, rescanning...`);
    const root = roots.find((r) => r.id === rootId);
    if (root) {
      await scanRoot(root);
      broadcast({ type: "root:updated", rootId });
    }
  });

  const port = 3000;
  console.log(`Server running at http://localhost:${port}`);

  Bun.serve({
    port,
    fetch: app.fetch,
  });
}

main();
