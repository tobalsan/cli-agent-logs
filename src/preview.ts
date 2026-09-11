/**
 * Lightweight extraction of initial user prompt from session files.
 * Only reads enough lines to find the first user message.
 */

const MAX_LINES = 200; // Don't read more than this many lines
const MAX_PROMPT_LENGTH = 200; // Truncate long prompts

export async function extractInitialPrompt(
  filePath: string,
  format: string
): Promise<string | undefined> {
  try {
    const file = Bun.file(filePath);
    const text = await file.text();
    const lines = text.split("\n").slice(0, MAX_LINES);

    switch (format) {
      case "pi_agent":
        return extractPiAgent(lines);
      case "factory":
        return extractFactory(lines);
      case "claude_projects":
        return extractClaudeProjects(lines);
      case "codex":
        return extractCodex(lines);
      default:
        return undefined;
    }
  } catch {
    return undefined;
  }
}

function truncate(text: string): string {
  if (text.length <= MAX_PROMPT_LENGTH) return text;
  return text.slice(0, MAX_PROMPT_LENGTH) + "…";
}

function extractPiAgent(lines: string[]): string | undefined {
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type === "message" && entry.message?.role === "user") {
        const content = entry.message.content;
        if (Array.isArray(content)) {
          const text = content.find((c: { type: string }) => c.type === "text")?.text;
          if (text) return truncate(text);
        }
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

function extractFactory(lines: string[]): string | undefined {
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type === "human") {
        const content = entry.message?.content;
        if (typeof content === "string") {
          return truncate(content);
        }
        if (Array.isArray(content)) {
          const text = content.find((c: { type: string }) => c.type === "text")?.text;
          if (text) return truncate(text);
        }
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

function extractClaudeProjects(lines: string[]): string | undefined {
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      // Claude projects format: { type: "user", message: { role: "user", content: "..." } }
      if (entry.type === "user" && entry.message) {
        const content = entry.message.content;
        if (typeof content === "string") {
          return truncate(content);
        }
        if (Array.isArray(content)) {
          const text = content.find((c: { type: string }) => c.type === "text")?.text;
          if (text) return truncate(text);
        }
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

function extractCodex(lines: string[]): string | undefined {
  // Injected context, not real prompts: messages wrapped in tags like
  // <recommended_plugins>, <environment_context>, <turn_aborted>, or AGENTS.md dumps
  const isInjected = (text: string) =>
    text.startsWith("<") || text.startsWith("# AGENTS.md instructions");

  let agentTask: string | undefined;
  let firstOutput: string | undefined;

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      // Codex format: { type: "response_item", payload: { type: "message", role: "user", content: [...] } }
      if (entry.type === "response_item" && entry.payload?.type === "message" && entry.payload?.role === "user") {
        const content = entry.payload.content;
        if (Array.isArray(content)) {
          const textBlock = content.find((c: { type: string }) => c.type === "input_text" || c.type === "text");
          const text = textBlock?.text?.trim();
          if (text && !isInjected(text)) return truncate(text);
        }
      }
      // Subagent sessions have no real user message; task arrives as agent_message
      if (!agentTask && entry.type === "response_item" && entry.payload?.type === "agent_message") {
        const content = entry.payload.content;
        if (Array.isArray(content)) {
          const textBlock = content.find((c: { type: string }) => c.type === "input_text" || c.type === "text");
          const text = textBlock?.text?.trim();
          if (text) agentTask = text;
        }
      }
      // Capture first assistant output or reasoning summary as fallback preview
      if (!firstOutput && entry.type === "response_item" && entry.payload?.type === "message" && entry.payload?.role === "assistant") {
        const content = entry.payload.content;
        if (Array.isArray(content)) {
          const textBlock = content.find((c: { type: string }) => c.type === "output_text" || c.type === "text");
          const text = textBlock?.text?.trim();
          if (text) firstOutput = text;
        }
      }
      if (!firstOutput && entry.type === "response_item" && entry.payload?.type === "reasoning") {
        const summary = entry.payload.summary;
        if (Array.isArray(summary)) {
          const summaryBlock = summary.find((s: { text?: string }) => s.text?.trim());
          const text = summaryBlock?.text?.trim();
          if (text) firstOutput = text;
        }
      }
    } catch {
      continue;
    }
  }
  if (agentTask) {
    if (/Payload:\s*$/.test(agentTask) && firstOutput) return truncate(firstOutput);
    return truncate(agentTask);
  }
  return firstOutput ? truncate(firstOutput) : undefined;
}

export interface CodexSessionInfo {
  nativeId?: string;
  threadSource?: string;
  parentThreadId?: string;
  agentNickname?: string;
  agentPath?: string;
}

export async function extractCodexSessionInfo(filePath: string): Promise<CodexSessionInfo | undefined> {
  try {
    const file = Bun.file(filePath);
    const text = await file.text();
    const firstLine = text.slice(0, text.indexOf("\n") === -1 ? text.length : text.indexOf("\n"));
    const entry = JSON.parse(firstLine);
    if (entry.type !== "session_meta") return undefined;

    const payload = entry.payload;
    return {
      nativeId: typeof payload?.id === "string" ? payload.id : undefined,
      threadSource: typeof payload?.thread_source === "string" ? payload.thread_source : undefined,
      parentThreadId: typeof payload?.parent_thread_id === "string" ? payload.parent_thread_id : undefined,
      agentNickname: typeof payload?.agent_nickname === "string" ? payload.agent_nickname : undefined,
      agentPath: typeof payload?.agent_path === "string" ? payload.agent_path : undefined,
    };
  } catch {
    return undefined;
  }
}

export interface TokenTotals {
  input: number;
  output: number;
  cacheRead: number;
}

export async function extractTokenTotals(
  filePath: string,
  format: string
): Promise<TokenTotals | undefined> {
  try {
    const file = Bun.file(filePath);
    const text = await file.text();
    const lines = text.split("\n");

    let input = 0;
    let output = 0;
    let cacheRead = 0;

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        let usage: Record<string, unknown> | undefined;

        if (format === "claude_projects" && entry.type === "assistant") {
          usage = entry.message?.usage;
        } else if (format === "pi_agent" && entry.type === "message" && entry.message?.role === "assistant") {
          usage = entry.message?.usage;
        } else if (format === "codex" && entry.type === "event_msg" && entry.payload?.type === "token_count") {
          const info = entry.payload?.info;
          if (info) {
            input += (info.input_tokens as number) || 0;
            output += (info.output_tokens as number) || 0;
            cacheRead += (info.cached_tokens as number) || 0;
          }
          continue;
        }

        if (usage) {
          input += (usage.input_tokens as number) || (usage.input as number) || 0;
          output += (usage.output_tokens as number) || (usage.output as number) || 0;
          cacheRead += (usage.cache_read_input_tokens as number) || (usage.cacheRead as number) || 0;
        }
      } catch {
        continue;
      }
    }

    if (input === 0 && output === 0) return undefined;
    return { input, output, cacheRead };
  } catch {
    return undefined;
  }
}
