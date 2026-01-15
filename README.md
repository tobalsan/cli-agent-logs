# CLI Agent Session Viewer

Observability tool for viewing CLI coding agent sessions (logs, conversations, tool calls).

## Usage

```bash
# Development (with hot reload)
bun run dev

# Production
bun run start
```

## Configuration

Create `config.json` with your session log roots:

```json
{
  "roots": [
    {
      "id": "my-agent",
      "label": "My Agent",
      "path": "~/.my-agent/sessions",
      "session_glob": "**/*.jsonl",
      "format": "pi_agent"
    }
  ]
}
```

| Field | Description |
|-------|-------------|
| `id` | Unique identifier |
| `label` | Display name |
| `path` | Directory containing session logs |
| `session_glob` | Glob pattern for session files |
| `format` | Log format (`pi_agent`, `factory`, or `claude_projects`) |

## Custom Parsers

To add a custom JSONL format:

1. Create `src/parsers/my_format.ts`:

```ts
import type { ParsedSession } from "./index";

export async function parseMyFormat(filePath: string): Promise<ParsedSession> {
  const text = await Bun.file(filePath).text();
  const lines = text.trim().split("\n").filter(Boolean);

  // Parse lines and return normalized structure
  return {
    metadata: { id: "...", timestamp: "...", cwd: "...", model: "..." },
    entries: [{ type: "message", timestamp: "...", message: { role: "assistant", content: [...] } }]
  };
}
```

2. Register in `src/parsers/index.ts`:

```ts
import { parseMyFormat } from "./my_format";

const parsers: Record<string, Parser> = {
  // ...existing
  my_format: parseMyFormat,
};
```

3. Use `"format": "my_format"` in `config.json`
