# Generic Web Page Extractor (兜底)

当链接不属于任何已知平台，或某平台的专用提取器失败时，用通用 OG meta + DOM 兜底解析。这个提取器只依赖 HTML `<meta>` 标签和基本 DOM，对大多数设置了 OG 协议的网页都有效。

## 适用场景

- 未知平台链接
- 已知平台专用提取器抛错后的回退
- 简单的博客/新闻/企业页面

## 等待条件

通用页面无需特别等待，DOM 加载即可。SSR 站点直接读，SPA 站点可能拿不到 OG meta（已在 `<head>` 里 SSR 的除外）：

```js
await browser_wait_for({ time: 2 });
```

## 提取器函数

```js
() => {
  const getMeta = (sel) =>
    document.querySelector(sel)?.content?.trim() || "";

  // 优先 OG 协议
  const title =
    getMeta('meta[property="og:title"]')
    || getMeta('meta[name="og:title"]')
    || getMeta('meta[name="title"]')
    || document.title
    || document.querySelector("h1")?.textContent?.trim()
    || "";

  const description =
    getMeta('meta[property="og:description"]')
    || getMeta('meta[name="og:description"]')
    || getMeta('meta[name="description"]')
    || getMeta('meta[name="Description"]')
    || "";

  const cover =
    getMeta('meta[property="og:image"]')
    || getMeta('meta[name="og:image"]')
    || getMeta('meta[name="twitter:image"]')
    || getMeta('meta[name="twitter:image:src"]')
    || document.querySelector("article img")?.src
    || document.querySelector("main img")?.src
    || "";

  const siteName =
    getMeta('meta[property="og:site_name"]')
    || getMeta('meta[name="application-name"]')
    || location.hostname;

  const type =
    getMeta('meta[property="og:type"]') || "website";

  const author =
    getMeta('meta[name="author"]')
    || getMeta('meta[property="article:author"]')
    || getMeta('meta[name="twitter:creator"]')
    || "";

  const publishTime =
    getMeta('meta[property="article:published_time"]')
    || getMeta('meta[name="article:published_time"]')
    || getMeta('meta[property="og:updated_time"]')
    || document.querySelector("time")?.dateTime
    || document.querySelector("time")?.textContent?.trim()
    || "";

  // 正文 - 尝试常见正文容器
  const bodyEl =
    document.querySelector("article")
    || document.querySelector("main")
    || document.querySelector(".article-content")
    || document.querySelector(".content")
    || document.querySelector(".post-content")
    || document.querySelector("#content")
    || document.querySelector(".container")
    || document.body;

  // 清理脚本和样式后再取文本
  const clone = bodyEl?.cloneNode(true);
  clone?.querySelectorAll("script, style, nav, header, footer, aside, iframe").forEach(el => el.remove());
  const body = clone?.innerText?.trim() || "";

  // 图片列表
  const images = Array.from(bodyEl?.querySelectorAll("img") || [])
    .map(img => img.src || img.dataset.src || img.getAttribute("data-original") || "")
    .filter(url => url && url.startsWith("http"))
    .filter((url, i, arr) => arr.indexOf(url) === i);

  // 视频
  const videoSrc = document.querySelector("video")?.src || "";
  const videoPoster = document.querySelector("video")?.poster || "";

  return {
    platform: "generic",
    url: location.href,
    type: videoSrc ? "video" : (type === "article" ? "article" : "page"),
    siteName,
    title,
    author: author ? { name: author } : undefined,
    publishTime,
    cover: cover || videoPoster,
    description,
    body: body.slice(0, 4000),
    images: images.slice(0, 20),
    media: videoSrc && videoSrc.startsWith("http")
      ? [{ url: videoSrc, quality: "default", type: "video" }]
      : [],
    extractedAt: new Date().toISOString(),
  };
}
```

## 注意点

- **OG meta 是基础**：几乎所有正经网站都设了 `og:title` / `og:description` / `og:image`，这是最可靠的兜底来源。
- **正文提取不准**：通用提取器对正文容器的猜测可能不准（拿到导航栏文本、广告等）。如果 body 里明显包含大量无关文本（"首页"、"登录"、"关于我们"等导航词），把 `body` 截短或只返回 description。
- **SPA 站点**：纯客户端渲染的 SPA（React/Vue 等无 SSR）DOM 在 JS 执行前是空的，OG meta 也可能在客户端才注入。如果第一次提取失败，可以：
  1. 多等几秒再试
  2. 检查 `document.documentElement.outerHTML` 里是否有 server-rendered 的 JSON（如 `__NEXT_DATA__`、`__NUXT__`）
  3. 如果多次尝试仍为空，说明该页面无 SSR，**放弃并告知用户**
- **已知硬限制：多 body 嵌套页面**：部分站点（如 MSN、部分 Twitter 嵌入页、某些 iframe 嵌套结构）使用多个 `<body>` 元素或 shadow DOM。这类页面会触发 Playwright MCP 的 `locator('body')` strict mode 错误，导致**浏览器路径完全无法工作**。遇到此类链接，告知用户"该页面使用了多文档嵌套结构，当前工具链无法解析。建议直接复制原文过来"。不要反复重试。
- **已知硬限制：纯 SPA 无 SSR**：部分站点（如 MSN、Medium 部分文章）的 HTML 源码中**不包含任何文章内容**，只有 `<script>` 标签加载 JS bundle。所有基于 fetch 的工具（fetch_markdown、fetch_readable、WebFetch 等）只能拿到空壳。如果 fetch 类工具全部失败且返回内容 <500 字符或以 JS 代码为主，放弃并告知用户。
- **付费墙/登录墙**：如果 body 为空或只有"请登录后查看"类文本，按 SKILL.md 的 "When to stop and ask" 处理，不要尝试绕过。
- **作为兜底**：当被作为已知平台提取器的 fallback 调用时，至少能拿到标题、描述、封面三件套，对用户来说也是有用信息。
