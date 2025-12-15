import { join, relative, basename } from "path";
import { Glob } from "bun";
import type { Root } from "./config";

export interface SessionMeta {
  id: string;
  rootId: string;
  path: string;
  filename: string;
  mtime: number;
  size: number;
}

const sessionIndex = new Map<string, SessionMeta[]>();
const sessionById = new Map<string, SessionMeta>();

function hashId(rootId: string, relativePath: string): string {
  const str = `${rootId}:${relativePath}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

export async function scanRoot(root: Root): Promise<SessionMeta[]> {
  const sessions: SessionMeta[] = [];
  const glob = new Glob(root.session_glob);

  for await (const file of glob.scan({ cwd: root.path, absolute: true })) {
    // Skip settings files for factory format
    if (file.endsWith(".settings.json")) continue;

    try {
      const stat = await Bun.file(file).stat();
      if (!stat) continue;

      const relativePath = relative(root.path, file);
      const id = hashId(root.id, relativePath);

      const meta: SessionMeta = {
        id,
        rootId: root.id,
        path: file,
        filename: basename(file),
        mtime: stat.mtime.getTime(),
        size: stat.size,
      };

      sessions.push(meta);
      sessionById.set(id, meta);
    } catch {
      // Skip files that can't be stat'd
    }
  }

  // Sort by mtime descending (newest first)
  sessions.sort((a, b) => b.mtime - a.mtime);
  sessionIndex.set(root.id, sessions);

  return sessions;
}

export async function scanAllRoots(roots: Root[]): Promise<void> {
  await Promise.all(roots.map(scanRoot));
}

export function getSessionsForRoot(rootId: string): SessionMeta[] {
  return sessionIndex.get(rootId) || [];
}

export function getSessionById(id: string): SessionMeta | undefined {
  return sessionById.get(id);
}

export function getAllSessions(): SessionMeta[] {
  const all: SessionMeta[] = [];
  for (const sessions of sessionIndex.values()) {
    all.push(...sessions);
  }
  return all.sort((a, b) => b.mtime - a.mtime);
}
