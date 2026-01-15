/**
 * Lightweight extraction of initial user prompt from session files.
 * Only reads enough lines to find the first user message.
 */

const MAX_LINES = 50; // Don't read more than this many lines
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
