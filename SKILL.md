---
name: link-parser
description: Parse links from Bilibili, Douyin, WeChat OA articles, Toutiao/Xigua, Zhihu, and generic web pages — extract metadata, cover, body text, and media URLs. Use when the user shares a link and asks to 解析/总结/看看. Optional video frame capture (截帧) or recording (录屏) on explicit request only.
---

# Link Parser

Parse a shared link from supported Chinese platforms and return a structured, assistant-readable summary. The skill runs inside a **logged-in Playwright browser** (the user is expected to be already logged in to Bilibili / Douyin etc.), reads the rendered page DOM plus embedded JSON state, and extracts: metadata, cover image, body text, and (where available) video/audio stream URLs.

> ⚠️ **Legal & ethical boundary** — only parse links the user has lawful access to (public pages or their own logged-in sessions). The extracted content is for the assistant's own situational awareness and the user's personal reading/audit. Do **not** republish extracted full text or download streams for redistribution, mass scraping, or bypassing paywalls. If the user wants the summary only, return the summary and skip the raw body.

## Workflow

```
1. Normalize URL      → short links (b23.tv, v.douyin.com, etc.) → follow to final URL
2. Route by host      → bilibili | douyin | wechat | toutiao | zhihu | generic
3. Open in browser    → mcp__plugin_playwright_playwright__browser_navigate
4. Wait for render    → wait_for key element that proves page loaded
5. Run platform extract → browser_evaluate with the platform's JS extractor
6. Post-process       → trim/cap body, normalize numbers, drop nulls
7a. [Optional] Capture frames → if video platform AND user said 截帧/视频预览/逐帧/取帧:
   a. Read references/video-frames.md
   b. Close danmaku → activate pipeline → loop seek+screenshot
   c. Append frame previews to card
7b. [Optional] Record video → if video platform AND user said 录屏/录像/录N秒:
   a. Read references/video-record.md
   b. Close danmaku → captureStream() + MediaRecorder
   c. Play N seconds → stop → download .webm → note in card
8. Return card        → markdown card in the format below
```

### Step 1: Normalize URL

Short links (`b23.tv/xxx`, `v.douyin.com/xxx`, `url.cn/xxx` for WeChat) must be followed to their final canonical URL before routing. Use `browser_navigate` and then read `window.location.href` — or pass `follow_redirects=true` semantics by just navigating and re-reading the URL.

### Step 2: Route by host

Match the final URL's hostname against:

| Host pattern | Platform | Reference |
|---|---|---|
| `bilibili.com` / `b23.tv` | Bilibili | `references/bilibili.md` |
| `douyin.com` / `iesdouyin.com` | Douyin | `references/douyin.md` |
| `mp.weixin.qq.com` / `weixin.qq.com` | WeChat OA article | `references/wechat.md` |
| `toutiao.com` / `ixigua.com` | Toutiao / Xigua | `references/toutiao.md` |
| `zhihu.com` | Zhihu | `references/zhihu.md` |
| *(anything else)* | Generic | `references/generic.md` |
| *(video platforms, optional)* | Video Frame Capture | `references/video-frames.md` |
| *(video platforms, optional)* | Video Recording | `references/video-record.md` |

**Read the matching reference file before extracting.** Each reference contains the platform-specific JS extractor function and the wait condition. Do not invent selectors — always use the documented one.

> 🎬 **Video frame capture** — After parsing a B站/抖音/西瓜 video, if the user explicitly asked to "截帧 / 视频预览 / 逐帧 / 取帧", read `references/video-frames.md` and capture one screenshot per second (default 5 frames) from the `<video>` element.
> 
> 🎥 **Video recording** — If the user asked to "录屏 / 录像 / 录 N 秒", read `references/video-record.md` and use `captureStream()` + `MediaRecorder` to record N seconds of the `<video>` element as a `.webm` file. This is different from frame capture — use recording for "录屏", frames for "截帧".
> 
> Do NOT capture frames or record unless the user explicitly asked — both are resource-intensive.

### Step 3–4: Open and wait

```js
// Always navigate first
await browser_navigate({ url: finalUrl });

// Then wait for the platform's "ready" signal — see each reference.
// Example for Bilibili: wait for the <video> tag or video data container.
await browser_wait_for({ text: "<some stable text>" }); // or time-based fallback
```

Common wait heuristics if the reference doesn't give a specific one:
- Wait 2–4s for SPA hydration.
- Wait for a selector that only appears on a fully-rendered page (e.g. `<video>`, `.article-content`, `#js_content`).

### Step 5: Run platform extractor

Each reference file defines an **extractor function** that returns a JSON object with a consistent shape:

```ts
type ParseResult = {
  platform: string;              // "bilibili" | "douyin" | ...
  url: string;                   // final canonical URL
  type: "video" | "article" | "answer" | "page";
  title: string;
  author?: { name: string; id?: string; url?: string };
  publishTime?: string;          // ISO 8601 if possible
  stats?: { views?: string; likes?: string; comments?: string; shares?: string };
  cover?: string;                // image URL
  duration?: string;             // for video, e.g. "12:34"
  body?: string;                 // plain text, capped at 4000 chars
  bodyHtml?: string;             // optional, original HTML
  media?: Array<{                // video/audio streams
    url: string;
    quality?: string;
    type: "video" | "audio";
  }>;
  extra?: Record<string, any>;   // platform-specific fields
  extractedAt: string;           // ISO timestamp
};
```

Extraction failure uses a **consistent error shape** instead of throwing — every extractor (platform or generic) must return this on failure so the router can decide retry/fallback without guessing:

```ts
type ErrorResult = {
  platform: string;
  url: string;
  error: string;                 // machine-readable code, e.g. "AUTO_PLAY_SWITCHED" | "LOGIN_WALL" | "NO_STATE"
  message?: string;              // human-readable explanation (Chinese ok)
  partial?: Partial<ParseResult>; // any fields salvaged before failure — still show them in the card
  extractedAt: string;
};
```

Rule of thumb: check `result.error` first. If present → follow the error-specific handling (retry once for `AUTO_PLAY_SWITCHED`, ask user for `LOGIN_WALL`, generic fallback otherwise). Never invent selectors to recover — fall back to generic.

Run it with:

```js
await browser_evaluate({ function: "<the extractor function body>" });
```

If the extractor throws or returns an `error` field (page structure changed, login wall, anti-bot), fall back to the **generic** extractor — it relies on OpenGraph / meta tags and works on most pages that set them.

### Step 6: Post-process

Before returning:
- **Trim body** to ≤4000 chars. If truncated, append `…(已截断，原文共 N 字)`.
- **Drop nulls** — omit `author`, `stats`, `media` etc. if they're empty, don't show `"author": null`.
- **Normalize numbers** — convert `"1.2万播放"` → `"1.2万"` (keep human-readable).
- **Don't include raw stream URLs** in the user-facing card unless the user explicitly asked for download. Stream URLs are large, expire fast, and clutter the card — keep them only in the raw result for the assistant.

### Step 8: Return card

Output a markdown card. Example shape:

```markdown
## 📺 B站视频解析

**标题**：[视频标题](canonical-url)
**UP主**：[作者名](author-url) · 粉丝 12.3万
**发布**：2024-03-15
**时长**：12:34
**数据**：▶ 1.2万播放  ❤ 1.5k点赞  💬 234弹幕

### 封面
![](cover-url)

### 简介
正文内容前 N 行…

---
*解析时间：2024-03-16 10:23 · 来源：bilibili.com*
```

Use the emoji prefix per platform: 📺 B站 / 🎵 抖音 / 📰 公众号 / 📰 头条/西瓜 / 💬 知乎 / 🌐 网页.

If the user only asked for a **summary** ("总结一下" / "帮我看看"), return the card **without** the raw body and **without** stream URLs — just the summary fields and a 2-3 sentence abstract the assistant writes from the body.

### Video frame preview (optional)

If the user asked for 截帧/视频预览/逐帧, append this section to the card:

```markdown
### 🎬 视频预览帧（每秒一帧）
[第 1 秒](frames_20261007131005/frame_01s.png) [第 2 秒](frames_20261007131005/frame_02s.png) [第 3 秒](frames_20261007131005/frame_03s.png) [第 4 秒](frames_20261007131005/frame_04s.png) [第 5 秒](frames_20261007131005/frame_05s.png)
```

If more than 5 frames were captured, add: `*截取前 N 秒，全部 N 帧已保存到本地。*`

Note: frame images are saved as PNG files in a per-run subfolder `frames_yyyyMMddHHmmss/` under the working directory (so consecutive parses never overwrite each other). They are NOT uploaded to any external service — the file paths are local references.

### Video recording result (optional)

If the user asked for 录屏/录像/录N秒, append this to the card:

```markdown
### 🎥 视频录屏（5 秒）
已保存到 `clip_5s_20261007131005.webm` · 1.5 MB · webm/VP9 格式
```

The `.webm` file is saved in the Playwright working directory (`.playwright-mcp/` or project root), named `clip_{N}s_yyyyMMddHHmmss.webm` — the timestamp prevents overwrites across runs. Use the actual `mimeType` returned by the recorder in the card (VP9 may fall back to plain webm).

## When to stop and ask

- If `browser_navigate` lands on a login/verification wall (URL contains `passport`, `login`, `captcha`, or the page text matches `/请登录|扫码登录|安全验证/`), **stop** and tell the user: "This page requires login/verification. Please log in to <platform> in the Playwright browser, then ask me to retry." Don't try to bypass.
- If the extractor throws and the generic fallback also returns almost nothing (no title, no body), tell the user honestly: "I couldn't extract structured content from this link. The page may be JS-rendered, behind login, or structurally changed. Here's what I got: <minimal fields>."
- If the user asks to **download/redistribute** copyrighted content at scale, decline and explain the legal boundary — but parsing a single link for personal reading is fine.

## Platform coverage

| Platform | Extractor strength |
|---|---|
| Bilibili | Strong — uses `window.__INITIAL_STATE__` |
| Douyin | Medium — DOM-based, structure changes often |
| WeChat OA | Strong — stable `#js_content` DOM |
| Toutiao/Xigua | Medium — DOM + meta |
| Zhihu | Medium — DOM + `initialData` |
| Generic | Best-effort OG meta |
| Video Frames (optional) | Screenshot `<video>` at each second |
| Video Recording (optional) | `captureStream()` + MediaRecorder → .webm |

Detail lives in `references/<platform>.md`. **Always read the reference before running the extractor** — selectors change, and the reference may have a fresher version than this file.
