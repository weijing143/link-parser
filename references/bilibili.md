# Bilibili Extractor

B站页面在 SSR 时把整个视频信息对象挂在 `window.__INITIAL_STATE__` 上，这是最稳定的来源。优先读它，DOM 只做兜底。

## 路由

- `bilibili.com/video/BVxxxx` -> 视频
- `bilibili.com/bangumi/play/epxxxx` -> 番剧
- `b23.tv/xxx` -> 短链，需先 navigate 一次拿到最终 URL
- `bilibili.com/read/cvxxxx` -> 专栏文章（type=article）

**URL 规范化（重要）**：用户分享的链接常带 `?share_source=...&vd_source=...` 等查询参数。navigate 前务必**只取 BV/ep/cv 号构造干净的 URL**（如 `https://www.bilibili.com/video/BV1Kdgb69Eym/`），丢弃所有 query string。原因：带分享参数的 URL 会触发 B站播放器的自动连播逻辑，把 `__INITIAL_STATE__` 切换成推荐视频的数据，导致解析到错误的视频。

## 等待条件

**navigate 后立即提取，最多等 1 秒。** 不要用 `browser_wait_for({ time: 3 })` 这种长等待——B站播放器在页面加载 2-3 秒后会自动连播下一个推荐视频，此时 `__INITIAL_STATE__.videoData` 会被覆盖成新视频的数据。

```js
// 正确做法：navigate 后最多等 1s 让 SSR 数据挂载，立即提取
await browser_navigate({ url: cleanUrl }); // 干净的 BV URL，无 query string
await browser_wait_for({ time: 1 });
const result = await browser_evaluate({ function: "<提取器函数>" });
// 然后立即校验 BV 号（见下方"注意点"）
```

如果第一次提取发现 `__INITIAL_STATE__` 还未挂载（`videoData.bvid` 为空），可再等 1s 重试一次，但**总等待不超过 2s**。

## 提取器函数

把下面整个函数体传给 `browser_evaluate` 的 `function` 参数：

```js
(targetBvid) => {
  const s = window.__INITIAL_STATE__ || {};
  const vd = s.videoData || {};
  const up = vd.owner || {};
  const stat = vd.stat || {};
  const pages = Array.isArray(vd.pages) ? vd.pages : [];

  // BV 号校验 - 防止自动连播切走后返回错误视频数据
  const currentBvid = vd.bvid || "";
  if (targetBvid && currentBvid && currentBvid !== targetBvid) {
    return {
      platform: "bilibili",
      url: location.href,
      error: "AUTO_PLAY_SWITCHED",
      message: `页面被自动连播切走。目标 BV 号 ${targetBvid}，实际页面 BV 号 ${currentBvid}。请用干净的 URL（无 query string）重试。`,
      targetBvid,
      actualBvid: currentBvid,
      extractedAt: new Date().toISOString(),
    };
  }

  const videoEl = document.querySelector("video");
  const videoSrc = videoEl?.src || "";

  const cover = vd.pic || document.querySelector('meta[property="og:image"]')?.content || "";

  const desc = vd.desc || "";

  const pubISO = vd.pubdate
    ? new Date(vd.pubdate * 1000).toISOString()
    : "";

  const tags = Array.isArray(s.tags) ? s.tags.map(t => t.tag_name).filter(Boolean) : [];

  const parts = pages.map((p, i) => ({
    part: p.part,
    duration: p.duration ? `${Math.floor(p.duration/60)}:${String(p.duration%60).padStart(2,'0')}` : "",
  }));

  return {
    platform: "bilibili",
    url: location.href,
    type: "video",
    bvid: vd.bvid,
    aid: vd.aid,
    title: vd.title,
    author: {
      name: up.name,
      mid: up.mid,
      url: up.mid ? `https://space.bilibili.com/${up.mid}` : undefined,
    },
    publishTime: pubISO,
    duration: vd.duration ? `${Math.floor(vd.duration/60)}:${String(vd.duration%60).padStart(2,'0')}` : "",
    stats: {
      views: stat.view != null ? String(stat.view) : undefined,
      danmaku: stat.danmaku != null ? String(stat.danmaku) : undefined,
      likes: stat.like != null ? String(stat.like) : undefined,
      coins: stat.coin != null ? String(stat.coin) : undefined,
      favorites: stat.favorite != null ? String(stat.favorite) : undefined,
      replies: stat.reply != null ? String(stat.reply) : undefined,
      shares: stat.share != null ? String(stat.share) : undefined,
    },
    cover,
    tags,
    parts,
    body: desc,
    media: videoSrc && videoSrc.startsWith("http")
      ? [{ url: videoSrc, quality: "default", type: "video" }]
      : [],
    extra: {
      tid: vd.tid,
      tname: vd.tname,
      cid: vd.cid,
    },
    extractedAt: new Date().toISOString(),
  };
}
```

**调用方式**：因为提取器需要 `targetBvid` 参数，用 `browser_evaluate` 调用时通过闭包传入。两种写法：

```js
// 写法 A：闭包内联（推荐，targetBvid 直接拼进函数体）
await browser_evaluate({
  function: `() => { const targetBvid = "BV1Kdgb69Eym"; ${提取器函数体去掉外层包裹} }`
});

// 写法 B：提取目标 BV 号 + 调用
// 1. 从用户 URL 解析出 BV 号：const targetBvid = url.match(/video\/(BV[\w]+)/)?.[1];
// 2. 把 targetBvid 拼进提取器函数的闭包
```

如果 `result.error === "AUTO_PLAY_SWITCHED"`，SKILL.md 应：用干净 URL 重新 navigate 一次并立即提取（最多重试 1 次），仍失败则走 generic 兜底并告知用户"页面被自动连播切走，仅拿到基础信息"。

## 注意点

- **自动连播陷阱（最易踩坑）**：B站视频页加载 2-3 秒后，播放器会自动连播下一个推荐视频，`window.__INITIAL_STATE__.videoData` 会被覆盖成新视频的数据，`location.href` 也会变成新 BV 号（URL 多出 `spm_id_from=333.788.player.switch`）。**必须**：
  1. navigate 前把 URL 规范化成只含 BV 号的干净链接（见上方"路由"）。
  2. navigate 后最多等 1 秒立即提取，不要长等待。
  3. 提取后**校验 `result.bvid === 目标BV号`**（从原始链接里解析出的 BV 号）。不一致就报错，返回 `{ platform: "bilibili", url, error: "页面被自动连播切走，目标视频数据被覆盖。请重试，或检查链接是否已失效。" }`，让 SKILL.md 决定是否重试或走 generic 兜底。
  
  目标 BV 号的提取方式：从用户给的 URL 里匹配 `/video/(BV[a-zA-Z0-9]+)/`。如果是 `b23.tv` 短链，先 navigate 拿到最终 URL 再提取 BV 号。

- `__INITIAL_STATE__` 可能因页面改版而字段缺失，做兜底：如果 `vd.bvid` 为空，返回 `{ platform: "bilibili", url, error: "no __INITIAL_STATE__.videoData" }` 然后让 SKILL.md 走 generic 兜底。
- **视频流 URL**：`<video>` 的 `src` 通常是 blob URL（`blob:https://...`），不能直接下载。要拿真实 mp4/dash 流需要调 `api.bilibili.com/x/player/playurl`，但这个接口需要正确的参数和 cookie。本 skill 只在 `videoSrc.startsWith("http")` 时返回流地址，blob 不返回，避免给用户假地址。
- **番剧页**（`/bangumi/play/`）结构不同，`__INITIAL_STATE__.epInfo` 而非 `videoData`。如果你看到 URL 含 `/bangumi/`，可改读 `s.epInfo.mediaInfo`。简单起见：番剧页走 generic OG meta 兜底也可接受。
- **专栏页**（`/read/cv`）：是纯文章，读 `#article-content` 的 textContent，type 设为 `"article"`。

## 专栏页简化提取器

```js
() => {
  const title = document.querySelector("h1.title")?.textContent?.trim()
    || document.title;
  const author = document.querySelector(".up-name")?.textContent?.trim();
  const body = document.querySelector("#article-content")?.innerText?.trim() || "";
  const cover = document.querySelector('meta[property="og:image"]')?.content || "";
  return {
    platform: "bilibili",
    url: location.href,
    type: "article",
    title,
    author: author ? { name: author } : undefined,
    cover,
    body: body.slice(0, 4000),
    extractedAt: new Date().toISOString(),
  };
}
```
