import { watch, type FSWatcher } from "fs";
import type { Root } from "./config";

export type WatchCallback = (rootId: string) => void;

const watchers = new Map<string, FSWatcher>();
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

const DEBOUNCE_MS = 500;

export function watchRoot(root: Root, onChange: WatchCallback): void {
  if (watchers.has(root.id)) {
    return;
  }

  try {
    const watcher = watch(root.path, { recursive: true }, (_event, filename) => {
      if (!filename?.endsWith(".jsonl")) return;

      // Debounce rapid changes
      const existing = debounceTimers.get(root.id);
      if (existing) clearTimeout(existing);

      debounceTimers.set(
        root.id,
        setTimeout(() => {
          debounceTimers.delete(root.id);
          onChange(root.id);
        }, DEBOUNCE_MS)
      );
    });

    watchers.set(root.id, watcher);
    console.log(`Watching ${root.path}`);
  } catch (err) {
    // If a configured root doesn't exist, don't spam the console with a full stack trace.
    if ((err as any)?.code === "ENOENT") {
      console.warn(`Watch skipped (missing path): ${root.path}`);
      return;
    }
    console.error(`Failed to watch ${root.path}:`, err);
  }
}

export function watchAllRoots(roots: Root[], onChange: WatchCallback): void {
  for (const root of roots) {
    watchRoot(root, onChange);
  }
}

export function stopWatching(): void {
  for (const [id, watcher] of watchers) {
    watcher.close();
    watchers.delete(id);
  }
  for (const timer of debounceTimers.values()) {
    clearTimeout(timer);
  }
  debounceTimers.clear();
}
