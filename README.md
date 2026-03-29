# Claude Code Session Exporter

Export conversation transcripts from [Claude Code](https://claude.ai/code) web sessions to clean, readable Markdown files.

Built because we needed it and nothing else worked.

## Why

Claude Code's web interface doesn't have a built-in export function. Existing Claude conversation exporters target the regular `claude.ai` chat DOM and don't work on `claude.ai/code` pages. We tried four different approaches — CLI export, official data export, existing browser extensions, manual copy — all failed.

So we built this.

## Features

- **One-click export** to Markdown (`.md`)
- **Smart message detection** — distinguishes User, Assistant, and tool call messages
- **Tool call collapsing** — tool invocations (Read, Edit, Bash, etc.) are wrapped in `<details>` tags for clean reading
- **Debug/Inspector mode** — DOM scanner to discover page structure, CSS selector tester, HTML dump. Useful if the DOM changes and selectors need updating.
- **Zero dependencies** — no external libraries, no data sent anywhere
- **Lightweight** — 6 files, ~35KB total

## Install

1. Clone or download this repo
2. Open Chrome → `chrome://extensions/`
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked** → select the repo folder
5. Navigate to any `claude.ai/code` session
6. Click the extension icon → **Export Markdown**

## Export Options

| Option | Default | Description |
|--------|---------|-------------|
| Include tool calls | On | Include Read, Edit, Bash, etc. in the export |
| Collapse tool calls | On | Wrap tool calls in `<details>` tags |
| Include system messages | Off | Include system/status messages |

## Output Format

```markdown
# Claude Code Session — 2026-03-29

**Exported:** 2026-03-29 14:32 CST
**URL:** https://claude.ai/code/session_abc123
**Messages:** 47

---

**User:**

Your message here.

---

**Assistant:**

Claude's response here.

<details>
<summary>Tool: Bash</summary>

Tool output here.

</details>

---
```

## Debug Mode

If the extension can't detect messages (e.g., after a Claude Code UI update), use Debug Mode:

1. Click the extension icon → **Debug Mode**
2. Click **Scan Page** — shows the page's DOM structure, data attributes, scrollable containers, and repeated class patterns
3. Use the **selector test field** to try CSS selectors and see what they match
4. Click **Dump HTML** to copy the conversation container's HTML to clipboard

Update the `SELECTOR_PROFILES.discovered` object in `content.js` with the correct selectors.

## Tech

- Chrome Manifest V3
- Content script injected on `claude.ai/code/*`
- Multi-strategy DOM scraping with configurable selector profiles
- Inline HTML-to-Markdown converter (no dependencies)
- Dark-themed popup UI

## Current Selectors (as of 2026-03-29)

These were discovered via Debug Mode on the live `claude.ai/code` interface:

- **Conversation container:** `.flex-1.overflow-y-auto`
- **Message blocks:** `.group\/message` (Tailwind group variant)
- **User messages:** `.group\/message:not(.text-text-100)`
- **Assistant messages:** `.group\/message.text-text-100`

If Claude updates their UI, these may change. Use Debug Mode to rediscover them.

## License

MIT

## Authors

**I. & Jackey**
