import type { ParsedSession, SessionEntry, ContentBlock } from "./index";

/**
 * Parser for AiHub sessions - supports two formats:
 *
 * Format A (legacy): type: "session" | "model_change" | "message"
 * Format B (claude-like): type: "user" | "assistant"
 */

type AihubLine = Record<string, unknown>;

type AihubContentBlock = {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  arguments?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string | Array<{ type: string; text?: string }>;
  is_error?: boolean;
  isError?: boolean;
};

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function normalizeContentBlocks(blocks: AihubContentBlock[]): ContentBlock[] {
  return blocks.map((b) => {
    // Claude API format
    if (b.type === "tool_use") {
      return {
        type: "toolCall",
        name: b.name,
        arguments: b.input,
        tool_use_id: b.id,
      };
    }

    // Legacy aihub format
    if (b.type === "toolCall") {
      return {
        type: "toolCall",
        name: b.name,
        arguments: b.arguments,
      };
    }

    if (b.type === "tool_result" || b.type === "toolResult") {
      let contentStr: string | undefined;
      if (typeof b.content === "string") {
        contentStr = b.content;
      } else if (Array.isArray(b.content)) {
        contentStr = b.content.map((c) => c.text).filter(Boolean).join("\n");
      }
      return {
        type: "toolResult",
        tool_use_id: b.tool_use_id ?? b.id,
        content: contentStr,
        is_error: b.is_error ?? b.isError,
      };
    }

    if (b.type === "thinking") {
      return {
        type: "thinking",
        thinking: b.thinking,
      };
    }

    return {
      type: b.type,
      text: b.text,
    };
  });
}

function coerceUserContentToText(content: unknown): ContentBlock[] {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }

  if (Array.isArray(content)) {
    return normalizeContentBlocks(content as AihubContentBlock[]);
  }

  return [{ type: "text", text: JSON.stringify(content) }];
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
    let obj: AihubLine;
    try {
      obj = JSON.parse(line) as AihubLine;
    } catch {
      continue;
    }

    const type = asString(obj.type);

    // Format A: legacy aihub format
    if (type === "session") {
      metadata = {
        id: asString(obj.id) || "",
        timestamp: asString(obj.timestamp),
        cwd: asString(obj.cwd),
      };
      entries.push({ type: "session", timestamp: asString(obj.timestamp) });
      continue;
    }

    if (type === "model_change") {
      currentModel = asString(obj.modelId);
      currentProvider = asString(obj.provider);
      if (!metadata.model) {
        metadata.model = currentModel;
        metadata.provider = currentProvider;
      }
      continue;
    }

    if (type === "message" && obj.message) {
      const msg = obj.message as Record<string, unknown>;
      const role = asString(msg.role);
      const contentRaw = msg.content as AihubContentBlock[] | undefined;

      if (contentRaw) {
        const content = normalizeContentBlocks(contentRaw);
        const rawUsage = obj.usage as Record<string, unknown> | undefined;

        entries.push({
          type: "message",
          timestamp: asString(obj.timestamp),
          message: {
            role: role === "toolResult" ? "user" : (role || "assistant"),
            content,
            model: asString(obj.model) || currentModel,
            usage: rawUsage
              ? {
                  input: rawUsage.inputTokens as number | undefined,
                  output: rawUsage.outputTokens as number | undefined,
                  cacheRead: rawUsage.cacheReadInputTokens as number | undefined,
                  cacheWrite: rawUsage.cacheWriteInputTokens as number | undefined,
                  cost: rawUsage.cost as { total?: number } | undefined,
                }
              : undefined,
          },
        });
      }
      continue;
    }

    // Format B: claude-like format (type: "user" | "assistant")
    if (type === "user" || type === "assistant") {
      const timestamp = asString(obj.timestamp);
      const cwd = asString(obj.cwd);
      const sessionId = asString(obj.sessionId) || asString(obj.id);

      if (!metadata.id) {
        metadata = {
          id: sessionId || "",
          timestamp,
          cwd,
          provider: "anthropic",
        };
        entries.push({ type: "session", timestamp });
      }

      const message = obj.message as Record<string, unknown> | undefined;
      if (!message) continue;

      const role = asString((message as any).role) || type;
      const contentRaw = (message as any).content;
      const blocks = Array.isArray(contentRaw)
        ? normalizeContentBlocks(contentRaw as AihubContentBlock[])
        : coerceUserContentToText(contentRaw);

      const model = asString((message as any).model);
      if (model && !metadata.model) {
        metadata.model = model;
      }

      const rawUsage = (message as any).usage as Record<string, unknown> | undefined;
      const hasUsage = rawUsage && (rawUsage.input_tokens || rawUsage.output_tokens);

      entries.push({
        type: "message",
        timestamp,
        message: {
          role,
          content: blocks,
          model,
          usage: hasUsage
            ? {
                input: rawUsage.input_tokens as number | undefined,
                output: rawUsage.output_tokens as number | undefined,
                cacheRead: rawUsage.cache_read_input_tokens as number | undefined,
                cacheWrite: rawUsage.cache_creation_input_tokens as number | undefined,
              }
            : undefined,
        },
      });
    }
  }

  if (!metadata.id) {
    metadata = { id: "" };
  }

  return { metadata, entries };
}
