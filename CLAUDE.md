# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun run dev    # Dev server with hot reload (port 3002)
bun run start  # Production server
```

## Architecture

Bun + Hono web app for viewing CLI agent session logs (JSONL format).

**Core flow:**
1. `config.ts` - Loads `config.json` defining log roots (path, glob pattern, format)
2. `indexer.ts` - Scans roots, builds in-memory index of sessions by hash ID
3. `watch.ts` - FSWatcher with debounce, triggers rescan on `.jsonl` changes
4. `server.ts` - Hono server with REST API + SSE for real-time updates
5. `parsers/` - Format-specific JSONL parsers returning normalized `ParsedSession`

**API endpoints:**
- `GET /api/roots` - List configured roots
- `GET /api/roots/:rootId/sessions` - List sessions for a root
- `GET /api/sessions/:sessionId` - Get parsed session data
- `GET /api/events` - SSE stream for live updates

**Adding parsers:** Create `src/parsers/my_format.ts` implementing `(filePath: string) => Promise<ParsedSession>`, register in `parsers/index.ts`, use `"format": "my_format"` in config.
