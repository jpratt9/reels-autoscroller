# Reels AutoScroller

Hands-free auto-scroll for short-form video feeds. When the current clip ends,
Reels AutoScroller advances to the next one for you — on **Instagram Reels**,
**YouTube Shorts**, **TikTok**, and **Facebook Reels**. 100% local, no tracking,
no network calls.

Built as a Manifest V3 Chrome extension. The UI uses the ViewShot palette:
charcoal surfaces with a `#39d353` green accent, dark-first with a light theme.

## Features

- **Auto-advance** when a video ends, using a layered strategy per platform
  (scroll container → `ArrowDown` → wheel → simulated swipe → window scroll)
  so it keeps working as each site's DOM changes.
- **Playback speed** control (0.1×–5×) from the popup or keyboard.
- **On-page status indicator** — a draggable pill showing Active/Paused, the
  video time, and a seekable progress bar. Per-platform position presets.
- **Keyboard shortcuts** — toggle, pause/resume, speed up/down, reset speed.
  All rebindable.
- **Pause when comments are open** (optional), with hysteresis so a flicker in
  the page doesn't thrash the pause state.
- **Auto-enable** on supported pages (optional).
- **Statistics** — per-platform scroll counts and total watch time.
- **Export / import** all settings and stats as JSON.

## Install (load unpacked)

1. `git clone` this repo.
2. Open `chrome://extensions`, enable **Developer mode**.
3. **Load unpacked** → select the repo folder.
4. Open Instagram Reels / YouTube Shorts / TikTok / a Facebook Reel and click
   the toolbar icon, or press **Alt+T**.

## Development

```bash
npm test              # run the node:test suite (no dependencies)
npm run package       # build reels-autoscroller.zip for the Chrome Web Store
```

## Project layout

```
manifest.json
icons/                      action icons (16/32/48/128)
src/shared/constants.js     platform tables, defaults, timing/video constants
src/shared/utils.js         platform detection, shortcut parsing, DOM helpers
src/content/platform.js     per-platform video selection + scroll + comments
src/content/ui.js           on-page status indicator
src/content/autoscroller.js content-script orchestrator
src/content/indicator.css   indicator styles
src/popup/                  toolbar popup
src/settings/               full settings page
tests/                      node:test suite
```

## Notes

Settings and statistics live in `chrome.storage.local`; nothing leaves the
browser. The content script only runs on the four supported hosts declared in
`manifest.json`.
