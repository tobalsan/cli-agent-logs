import type { ParsedSession, SessionEntry, ContentBlock } from "./index";

interface PiAgentEntry {
  type: string;
  id?: string;
  timestamp?: string;
  cwd?: string;
  provider?: string;
  modelId?: string;
  thinkingLevel?: string;
  message?: {
    role: string;
    content: Array<{ type: string; text?: string }>;
    usage?: {
      input?: number;
      output?: number;
      cacheRead?: number;
      cacheWrite?: number;
      cost?: { total?: number };
    };
  };
}

export async function parsePiAgent(filePath: string): Promise<ParsedSession> {
  const file = Bun.file(filePath);
  const text = await file.text();
  const lines = text.trim().split("\n").filter(Boolean);

  let metadata: ParsedSession["metadata"] = { id: "" };
  const entries: SessionEntry[] = [];

  for (const line of lines) {
    const entry = JSON.parse(line) as PiAgentEntry;

    if (entry.type === "session") {
      metadata = {
        id: entry.id || "",
        timestamp: entry.timestamp,
        cwd: entry.cwd,
        model: entry.modelId,
        provider: entry.provider,
      };
      entries.push({ type: "session", timestamp: entry.timestamp });
    } else if (entry.type === "message" && entry.message) {
      const content: ContentBlock[] = entry.message.content.map((c: Record<string, unknown>) => {
        if (c.type === "toolCall") {
          return {
            type: "toolCall",
            name: c.name as string,
            arguments: c.arguments as Record<string, unknown>,
          };
        } else if (c.type === "thinking") {
          return {
            type: "thinking",
            thinking: c.thinking as string,
          };
        }
        return {
          type: c.type as string,
          text: c.text as string,
        };
      });

      entries.push({
        type: "message",
        timestamp: entry.timestamp,
        message: {
          role: entry.message.role,
          content,
          usage: entry.message.usage,
        },
      });
    }
  }

  return { metadata, entries };
}
