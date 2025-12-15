import { homedir } from "os";
import { resolve } from "path";

export interface Root {
  id: string;
  label: string;
  path: string;
  session_glob: string;
  format: string;
}

export interface Config {
  roots: Root[];
}

function expandPath(p: string): string {
  if (p.startsWith("~/")) {
    return resolve(homedir(), p.slice(2));
  }
  return resolve(p);
}

export async function loadConfig(): Promise<Config> {
  const configPath = resolve(import.meta.dir, "../config.json");
  const file = Bun.file(configPath);
  const raw = await file.json() as Config;

  return {
    roots: raw.roots.map((r) => ({
      ...r,
      path: expandPath(r.path),
    })),
  };
}
