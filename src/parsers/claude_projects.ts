import type { ParsedSession, SessionEntry, ContentBlock } from "./index";

/**
 * Parser for Claude Code sessions stored in ~/.claude/projects/**
 *
 * Observed format: JSONL where each line is a JSON object. Lines can be:
 * - meta/snapshot objects (we ignore)
 * - user/assistant messages (we normalize)
 *
 * Key fields seen:
 * - type: "user" | "assistant" | (others)
 * - timestamp: ISO string
 * - cwd: string
 * - sessionId: string
 * - agentId: string (for sidechains)
 * - message: for user lines: { role: "user", content: string | array }
 * - message: for assistant lines: Claude message object { role, content: [...], usage, ... }
 */

type ClaudeProjectsLine = Record<string, unknown>;

type ClaudeMessageContentBlock = {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
  is_error?: boolean;
};

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function normalizeContentBlocks(blocks: ClaudeMessageContentBlock[]): ContentBlock[] {
  return blocks.map((b) => {
    // Claude tool call
    if (b.type === "tool_use") {
      return {
        type: "toolCall",
        name: b.name,
        arguments: b.input,
        tool_use_id: b.id,
      };
    }

    // Claude tool result
    if (b.type === "tool_result") {
      return {
        type: "toolResult",
        tool_use_id: b.tool_use_id,
        content: b.content,
        is_error: b.is_error,
      };
    }

    if (b.type === "thinking") {
      return {
        type: "thinking",
        thinking: b.thinking,
      };
    }

    // Default: treat as text-ish
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
    // Some user messages could include tool_result blobs. Try to normalize best-effort.
    const blocks: ContentBlock[] = [];
    for (const item of content as Array<Record<string, unknown>>) {
      const type = asString(item.type) || "text";
      if (type === "tool_result") {
        blocks.push({
          type: "toolResult",
          tool_use_id: asString(item.tool_use_id),
          content: typeof item.content === "string" ? item.content : JSON.stringify(item.content),
        });
      } else {
        blocks.push({
          type,
          text: asString(item.text) ?? (typeof item.content === "string" ? item.content : undefined),
        });
      }
    }
    return blocks;
  }

  return [{ type: "text", text: JSON.stringify(content) }];
}

export async function parseClaudeProjects(filePath: string): Promise<ParsedSession> {
  const file = Bun.file(filePath);
  const text = await file.text();
  const lines = text.trim().split("\n").filter(Boolean);

  let metadata: ParsedSession["metadata"] = { id: "" };
  const entries: SessionEntry[] = [];

  for (const line of lines) {
    let obj: ClaudeProjectsLine;
    try {
      obj = JSON.parse(line) as ClaudeProjectsLine;
    } catch {
      continue;
    }

    const type = asString(obj.type);

    // Ignore snapshot / other non-message lines
    if (type !== "user" && type !== "assistant") continue;

    const timestamp = asString(obj.timestamp);
    const cwd = asString(obj.cwd);
    const sessionId = asString(obj.sessionId) || asString(obj.id);

    // Initialize metadata on first meaningful line
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

    if (type === "user") {
      const role = asString((message as any).role) || "user";
      const content = coerceUserContentToText((message as any).content);

      entries.push({
        type: "message",
        timestamp,
        message: {
          role,
          content,
        },
      });
      continue;
    }

    // assistant
    const role = asString((message as any).role) || "assistant";
    const contentRaw = (message as any).content;

    const blocks = Array.isArray(contentRaw)
      ? normalizeContentBlocks(contentRaw as ClaudeMessageContentBlock[])
      : coerceUserContentToText(contentRaw);

    // Try to extract model if present
    const model = asString((message as any).model);
    if (model && !metadata.model) {
      metadata.model = model;
    }

    entries.push({
      type: "message",
      timestamp,
      message: {
        role,
        content: blocks,
        usage: (message as any).usage as any,
      },
    });
  }

  // Fallback metadata if file had no parsed lines
  if (!metadata.id) {
    metadata = { id: "" };
  }

  return { metadata, entries };
}
