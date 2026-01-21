import type { ParsedSession, SessionEntry, ContentBlock } from "./index";

interface AihubEntry {
  type: string;
  id?: string;
  parentId?: string;
  timestamp?: string;
  version?: number;
  cwd?: string;
  provider?: string;
  modelId?: string;
  thinkingLevel?: string;
  message?: {
    role: string;
    content: Array<{
      type: string;
      text?: string;
      thinking?: string;
      id?: string;
      name?: string;
      arguments?: Record<string, unknown>;
      content?: Array<{ type: string; text?: string }>;
      isError?: boolean;
    }>;
    timestamp?: number;
  };
  api?: string;
  model?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadInputTokens?: number;
    cacheWriteInputTokens?: number;
    cost?: { total?: number };
  };
}

export async function parseAihub(filePath: string): Promise<ParsedSession> {
  const file = Bun.file(filePath);
  const text = await file.text();
  const lines = text.trim().split("\n").filter(Boolean);

  let metadata: ParsedSession["metadata"] = { id: "" };
  const entries: SessionEntry[] = [];
  let currentModel: string | undefined;
  let currentProvider: string | undefined;

  for (const line of lines) {
    const entry = JSON.parse(line) as AihubEntry;

    if (entry.type === "session") {
      metadata = {
        id: entry.id || "",
        timestamp: entry.timestamp,
        cwd: entry.cwd,
      };
      entries.push({ type: "session", timestamp: entry.timestamp });
    } else if (entry.type === "model_change") {
      currentModel = entry.modelId;
      currentProvider = entry.provider;
      if (!metadata.model) {
        metadata.model = currentModel;
        metadata.provider = currentProvider;
      }
    } else if (entry.type === "message" && entry.message) {
      const content: ContentBlock[] = entry.message.content.map((c) => {
        if (c.type === "toolCall") {
          return {
            type: "toolCall",
            name: c.name,
            arguments: c.arguments,
          };
        } else if (c.type === "toolResult") {
          const resultText = c.content
            ?.map((r) => r.text)
            .filter(Boolean)
            .join("\n");
          return {
            type: "toolResult",
            tool_use_id: c.id,
            content: resultText,
            is_error: c.isError,
          };
        } else if (c.type === "thinking") {
          return {
            type: "thinking",
            thinking: c.thinking,
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
          role: entry.message.role === "toolResult" ? "user" : entry.message.role,
          content,
          model: entry.model || currentModel,
          usage: entry.usage
            ? {
                input: entry.usage.inputTokens,
                output: entry.usage.outputTokens,
                cacheRead: entry.usage.cacheReadInputTokens,
                cacheWrite: entry.usage.cacheWriteInputTokens,
                cost: entry.usage.cost,
              }
            : undefined,
        },
      });
    }
  }

  return { metadata, entries };
}
