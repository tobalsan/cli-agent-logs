import { parsePiAgent } from "./pi_agent";
import { parseFactory } from "./factory";
import { parseClaudeProjects } from "./claude_projects";

export interface ParsedSession {
  metadata: {
    id: string;
    timestamp?: string;
    cwd?: string;
    model?: string;
    provider?: string;
    title?: string;
  };
  entries: SessionEntry[];
}

export interface SessionEntry {
  type: string;
  timestamp?: string;
  message?: {
    role: string;
    content: ContentBlock[];
    model?: string;
    usage?: {
      input?: number;
      output?: number;
      cacheRead?: number;
      cacheWrite?: number;
      cost?: { total?: number };
    };
  };
}

export interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  name?: string;
  arguments?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
  is_error?: boolean;
}

type Parser = (filePath: string) => Promise<ParsedSession>;

const parsers: Record<string, Parser> = {
  pi_agent: parsePiAgent,
  factory: parseFactory,
  claude_projects: parseClaudeProjects,
};

export function getParser(format: string): Parser | undefined {
  return parsers[format];
}
