import { relative, basename } from "path";
import { Glob } from "bun";
import { stat } from "fs/promises";
import type { Root } from "./config";
import { extractInitialPrompt, extractTokenTotals, type TokenTotals } from "./preview";

export interface SessionMeta {
  id: string;
  rootId: string;
  path: string;
  relativePath: string;
  filename: string;
  displayName: string;
  mtime: number;
  size: number;
  initialPrompt?: string;
  tokens?: TokenTotals;
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

function applyFolderMasks(name: string, masks?: string[]): string {
  if (!masks) return name;
  for (const mask of masks) {
    if (name.startsWith(mask)) {
      return name.slice(mask.length);
    }
  }
  return name;
}

export async function scanRoot(root: Root): Promise<SessionMeta[]> {
  const sessions: SessionMeta[] = [];

  // If the configured root folder doesn't exist, don't crash the server.
  try {
    await stat(root.path);
  } catch {
    sessionIndex.set(root.id, sessions);
    return sessions;
  }

  const glob = new Glob(root.session_glob);

  for await (const file of glob.scan({ cwd: root.path, absolute: true })) {
    // Skip settings files for factory format
    if (file.endsWith(".settings.json")) continue;

    try {
      const st = await stat(file);

      const relativePath = relative(root.path, file);
      const id = hashId(root.id, relativePath);
      const filename = basename(file);

      const [initialPrompt, tokens] = await Promise.all([
        extractInitialPrompt(file, root.format),
        extractTokenTotals(file, root.format),
      ]);

      const meta: SessionMeta = {
        id,
        rootId: root.id,
        path: file,
        relativePath,
        filename,
        displayName: applyFolderMasks(relativePath, root.folder_masks),
        mtime: st.mtime.getTime(),
        size: st.size,
        initialPrompt,
        tokens,
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
