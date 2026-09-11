import type { ParsedSession, SessionEntry, ContentBlock } from "./index";

/**
 * Parser for Codex sessions stored in ~/.codex/sessions
 *
 * Format: JSONL where each line has { timestamp, type, payload }
 * Event types:
 * - session_meta: Session initialization with id, cwd, model_provider, etc.
 * - response_item: Messages (user/assistant), function_call, function_call_output, reasoning
 * - event_msg: Token counts, user messages, agent reasoning
 * - turn_context: Execution context (cwd, model, effort, etc.)
 */

type CodexLine = {
  timestamp?: string;
  type: string;
  payload: Record<string, unknown>;
};

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function parseArguments(args: unknown): Record<string, unknown> | undefined {
  if (typeof args === "string") {
    try {
      return JSON.parse(args);
    } catch {
      return { raw: args };
    }
  }
  if (typeof args === "object" && args !== null) {
    return args as Record<string, unknown>;
  }
  return undefined;
}

export async function parseCodex(filePath: string): Promise<ParsedSession> {
  const file = Bun.file(filePath);
  const text = await file.text();
  const lines = text.trim().split("\n").filter(Boolean);

  let metadata: ParsedSession["metadata"] = { id: "" };
  const entries: SessionEntry[] = [];

  // Track function calls to associate with outputs
  const pendingFunctionCalls: Map<string, ContentBlock> = new Map();
  let currentAssistantBlocks: ContentBlock[] = [];
  let currentTimestamp: string | undefined;
  let lastModel: string | undefined;

  function flushAssistantMessage() {
    if (currentAssistantBlocks.length > 0) {
      entries.push({
        type: "message",
        timestamp: currentTimestamp,
        message: {
          role: "assistant",
          content: currentAssistantBlocks,
          model: lastModel,
        },
      });
      currentAssistantBlocks = [];
    }
  }

  for (const line of lines) {
    let obj: CodexLine;
    try {
      obj = JSON.parse(line) as CodexLine;
    } catch {
      continue;
    }

    const { type, payload, timestamp } = obj;

    // Session metadata
    if (type === "session_meta") {
      metadata = {
        id: asString(payload.id) || "",
        timestamp: asString(payload.timestamp) || timestamp,
        cwd: asString(payload.cwd),
        provider: asString(payload.model_provider) || "openai",
      };
      entries.push({ type: "session", timestamp });
      continue;
    }

    // Turn context - extract model
    if (type === "turn_context") {
      const model = asString(payload.model);
      if (model) {
        lastModel = model;
        if (!metadata.model) {
          metadata.model = model;
        }
      }
      continue;
    }

    // Response items (messages, function calls, outputs, reasoning)
    if (type === "response_item") {
      const itemType = asString(payload.type);

      // User or assistant message
      if (itemType === "message") {
        const role = asString(payload.role);
        const contentRaw = payload.content as unknown[] | undefined;

        if (role === "user") {
          flushAssistantMessage();

          const blocks: ContentBlock[] = [];
          if (Array.isArray(contentRaw)) {
            for (const item of contentRaw) {
              const itemObj = item as Record<string, unknown>;
              const blockType = asString(itemObj.type);
              if (blockType === "input_text") {
                blocks.push({ type: "text", text: asString(itemObj.text) });
              } else {
                blocks.push({
                  type: blockType || "text",
                  text: asString(itemObj.text),
                });
              }
            }
          }

          const combined = blocks.map((b) => b.text || "").join("\n").trim();
          const isInjected = combined.startsWith("<") || combined.startsWith("# AGENTS.md instructions");

          entries.push({
            type: "message",
            timestamp,
            message: { role: isInjected ? "system" : "user", content: blocks },
          });
          currentTimestamp = timestamp;
        } else if (role === "assistant") {
          // Assistant messages may contain text
          if (Array.isArray(contentRaw)) {
            for (const item of contentRaw) {
              const itemObj = item as Record<string, unknown>;
              const blockType = asString(itemObj.type);
              if (blockType === "output_text") {
                currentAssistantBlocks.push({
                  type: "text",
                  text: asString(itemObj.text),
                });
              } else if (blockType === "text") {
                currentAssistantBlocks.push({
                  type: "text",
                  text: asString(itemObj.text),
                });
              }
            }
          }
          currentTimestamp = timestamp;
        }
        continue;
      }

      // Subagent task message
      if (itemType === "agent_message") {
        const contentRaw = payload.content as unknown[] | undefined;
        const blocks: ContentBlock[] = [];
        if (Array.isArray(contentRaw)) {
          for (const item of contentRaw) {
            const itemObj = item as Record<string, unknown>;
            const t = asString(itemObj.type);
            if (t === "input_text" || t === "text") {
              blocks.push({ type: "text", text: asString(itemObj.text) });
            } else if (t === "encrypted_content" || typeof itemObj.encrypted_content === "string") {
              blocks.push({ type: "text", text: "[payload encrypted by OpenAI, not locally readable]" });
            }
          }
        }
        if (blocks.length > 0) {
          flushAssistantMessage();
          entries.push({
            type: "message",
            timestamp,
            message: { role: "user", content: blocks },
          });
        }
        currentTimestamp = timestamp;
        continue;
      }

      // Reasoning/thinking
      if (itemType === "reasoning") {
        const summary = payload.summary as Array<{ text?: string }> | undefined;
        if (Array.isArray(summary)) {
          const thinkingText = summary
            .map((s) => s.text || "")
            .filter(Boolean)
            .join("\n");
          if (thinkingText) {
            currentAssistantBlocks.push({
              type: "thinking",
              thinking: thinkingText,
            });
          }
        }
        currentTimestamp = timestamp;
        continue;
      }

      // Function call (tool use)
      if (itemType === "function_call") {
        const callId = asString(payload.call_id);
        const name = asString(payload.name);
        const args = parseArguments(payload.arguments);

        const toolBlock: ContentBlock = {
          type: "toolCall",
          name,
          arguments: args,
          tool_use_id: callId,
        };

        currentAssistantBlocks.push(toolBlock);
        if (callId) {
          pendingFunctionCalls.set(callId, toolBlock);
        }
        currentTimestamp = timestamp;
        continue;
      }

      // Function call output (tool result)
      if (itemType === "function_call_output") {
        const callId = asString(payload.call_id);
        const output = asString(payload.output);

        // Flush current assistant message before tool result
        flushAssistantMessage();

        entries.push({
          type: "message",
          timestamp,
          message: {
            role: "user",
            content: [
              {
                type: "toolResult",
                tool_use_id: callId,
                content: output,
              },
            ],
          },
        });
        continue;
      }

      // Custom tool call (e.g., apply_patch)
      if (itemType === "custom_tool_call") {
        const callId = asString(payload.call_id);
        const name = asString(payload.name);
        const input = asString(payload.input);

        const toolBlock: ContentBlock = {
          type: "toolCall",
          name,
          arguments: input ? { input } : undefined,
          tool_use_id: callId,
        };

        currentAssistantBlocks.push(toolBlock);
        if (callId) {
          pendingFunctionCalls.set(callId, toolBlock);
        }
        currentTimestamp = timestamp;
        continue;
      }

      // Custom tool call output
      if (itemType === "custom_tool_call_output") {
        const callId = asString(payload.call_id);
        const outputRaw = asString(payload.output);

        // Try to parse JSON output for cleaner display
        let output = outputRaw;
        if (outputRaw) {
          try {
            const parsed = JSON.parse(outputRaw);
            output = parsed.output || outputRaw;
          } catch {
            // Keep raw output
          }
        }

        // Flush current assistant message before tool result
        flushAssistantMessage();

        entries.push({
          type: "message",
          timestamp,
          message: {
            role: "user",
            content: [
              {
                type: "toolResult",
                tool_use_id: callId,
                content: output,
              },
            ],
          },
        });
        continue;
      }
    }

    // Event messages - extract token usage
    if (type === "event_msg") {
      const msgType = asString(payload.type);

      if (msgType === "token_count") {
        const info = payload.info as Record<string, unknown> | undefined;
        if (info && currentAssistantBlocks.length > 0) {
          // We have usage info - flush with it
          const lastEntry = entries[entries.length - 1];
          if (lastEntry?.message?.role === "assistant" && lastEntry.message) {
            lastEntry.message.usage = {
              input: (info.input_tokens as number) || undefined,
              output: (info.output_tokens as number) || undefined,
              cacheRead: (info.cached_tokens as number) || undefined,
            };
          }
        }
      }
    }
  }

  // Flush any remaining assistant content
  flushAssistantMessage();

  // Fallback metadata
  if (!metadata.id) {
    metadata = { id: "" };
  }

  return { metadata, entries };
}
