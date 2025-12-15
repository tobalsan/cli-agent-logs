import type { ParsedSession, SessionEntry, ContentBlock } from "./index";

interface FactoryEntry {
  type: string;
  id?: string;
  timestamp?: string;
  title?: string;
  owner?: string;
  version?: number;
  cwd?: string;
  message?: {
    role: string;
    content: Array<{
      type: string;
      text?: string;
      id?: string;
      name?: string;
      input?: Record<string, unknown>;
      tool_use_id?: string;
      content?: string;
    }>;
  };
}

export async function parseFactory(filePath: string): Promise<ParsedSession> {
  const file = Bun.file(filePath);
  const text = await file.text();
  const lines = text.trim().split("\n").filter(Boolean);

  let metadata: ParsedSession["metadata"] = { id: "" };
  const entries: SessionEntry[] = [];

  // Try to load settings file
  const settingsPath = filePath.replace(".jsonl", ".settings.json");
  let settings: Record<string, unknown> = {};
  try {
    const settingsFile = Bun.file(settingsPath);
    if (await settingsFile.exists()) {
      settings = await settingsFile.json();
    }
  } catch {
    // Settings file is optional
  }

  for (const line of lines) {
    const entry = JSON.parse(line) as FactoryEntry;

    if (entry.type === "session_start") {
      metadata = {
        id: entry.id || "",
        timestamp: entry.timestamp,
        cwd: entry.cwd,
        title: entry.title,
        model: settings.model as string | undefined,
        provider: settings.apiProviderLock as string | undefined,
      };
      entries.push({ type: "session", timestamp: entry.timestamp });
    } else if (entry.type === "message" && entry.message) {
      const content: ContentBlock[] = entry.message.content.map((c) => {
        if (c.type === "tool_use") {
          return {
            type: "toolCall",
            name: c.name,
            arguments: c.input,
          };
        } else if (c.type === "tool_result") {
          return {
            type: "toolResult",
            tool_use_id: c.tool_use_id,
            content: c.content,
          };
        }
        return {
          type: c.type,
          text: c.text,
        };
      });

      entries.push({
        type: "message",
        timestamp: entry.timestamp,
        message: {
          role: entry.message.role,
          content,
        },
      });
    }
  }

  return { metadata, entries };
}
