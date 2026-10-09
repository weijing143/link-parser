# Toutiao / Xigua Video Extractor

今日头条文章（`toutiao.com/article/xxx` 或 `m.toutiao.com/article/xxx`）和西瓜视频（`ixigua.com/xxx`）同属字节系，DOM 和 SSR 结构相近但域名不同。

## 路由

- `toutiao.com/article/{id}` -> 头条文章
- `m.toutiao.com/article/{id}` -> 移动版文章（结构更简单，推荐）
- `ixigua.com/{id}` 或 `ixigua.com/video/{id}` -> 西瓜视频
- `m.ixigua.com` -> 移动版西瓜
- `toutiao.com/w/` -> 微头条

## 等待条件

```js
await browser_wait_for({ time: 3 });
// 文章页等正文容器
// 视频页等 <video>
```

## 文章提取器

```js
() => {
  const title =
    document.querySelector("h1")?.textContent?.trim()
    || document.querySelector("article .title")?.textContent?.trim()
    || document.title;

  const text = document.body.innerText;

  // 作者 - 优先取作者主页链接的文本（最可靠）；innerText 正则和 class 选择器兜底
  // 注意：innerText 正则不能直接用——页面"作者"标签旁紧跟"关注"按钮，
  //       会误捕"关注"当作者名
  const authorLinkEl = document.querySelector("a[href*='/user/']");
  const authorFromLink = authorLinkEl?.textContent?.trim();
  const authorMatch = text.match(/(?:记者|作者|编辑)\s+(\S{1,6})/);
  const author =
    (authorFromLink && !/^(关注|粉丝)$/.test(authorFromLink) ? authorFromLink : undefined)
    || (authorMatch && !/^(关注|粉丝)$/.test(authorMatch[1]) ? authorMatch[1] : undefined)
    || document.querySelector(".article-author-name")?.textContent?.trim()
    || document.querySelector("[data-log-name='author']")?.textContent?.trim()
    || document.querySelector(".author-name")?.textContent?.trim();

  const authorUrl = authorLinkEl?.href || "";

  // 发布时间 - innerText 正则优先（头条 DOM 选择器不稳定）
  const timeMatch = text.match(/(\d{4}-\d{2}-\d{2}\s*\d{2}:\d{2})/);
  const publishTime =
    (timeMatch ? timeMatch[1] : undefined)
    || document.querySelector(".article-info .time")?.textContent?.trim()
    || document.querySelector("[data-log-name='time']")?.textContent?.trim()
    || document.querySelector(".meta time")?.textContent?.trim();

  // 正文容器 - 头条页面有多个 <article>（含视频播放器），用 .syl-article-base 精准定位
  const bodyEl =
    document.querySelector(".syl-article-base")
    || document.querySelector("article.syl-article-base")
    || document.querySelector(".article-content")
    || document.querySelector(".content")
    || document.querySelector("article:not(.xgplayer)");

  // 正文提取：优先用 <p> 段落拼接（自动跳过视频播放器的 DOM 噪声）
  // 头条的 .syl-article-base 里同时包含播放器和文章段落
  const paragraphs = Array.from(bodyEl?.querySelectorAll('p') || [])
    .map(p => p.textContent?.trim())
    .filter(t => t && t.length > 5);
  const body = paragraphs.join('\n').trim() || bodyEl?.innerText?.trim() || "";
  const bodyHtml = bodyEl?.innerHTML || "";

  // 封面 - og:image 优先
  const cover =
    document.querySelector('meta[property="og:image"]')?.content
    || document.querySelector(".syl-article-base img")?.src
    || "";

  // 图片 - 仅正文容器内的（排除播放器）
  const images = Array.from((bodyEl || document).querySelectorAll("img") || [])
    .map(img => img.src || img.dataset.src)
    .filter(url => url && url.startsWith("http"))
    .filter((url, i, arr) => arr.indexOf(url) === i);

  return {
    platform: "toutiao",
    url: location.href,
    type: "article",
    title,
    author: author ? { name: author, url: authorUrl } : undefined,
    publishTime,
    cover,
    body: body.slice(0, 4000),
    bodyHtml: bodyHtml.slice(0, 20000),
    images: images.slice(0, 20),
    extractedAt: new Date().toISOString(),
  };
}
```

## 西瓜视频提取器

西瓜视频页把数据塞在 `window._SSR_DATA_` 或 `__INITIAL_STATE__`：

```js
() => {
  const title =
    document.querySelector("h1")?.textContent?.trim()
    || document.title;

  const author =
    document.querySelector(".author-name")?.textContent?.trim()
    || document.querySelector("[class*='author']")?.textContent?.trim();

  const publishTime =
    document.querySelector(".video-time")?.textContent?.trim()
    || document.querySelector("[class*='time']")?.textContent?.trim();

  const desc =
    document.querySelector(".video-desc")?.textContent?.trim()
    || document.querySelector("[class*='desc']")?.textContent?.trim()
    || "";

  const videoEl = document.querySelector("video");
  const cover = videoEl?.poster
    || document.querySelector('meta[property="og:image"]')?.content
    || "";
  const videoSrc = videoEl?.src || "";

  // 西瓜的 SSR_DATA 里可能含真实流地址
  let realStreamUrl = "";
  try {
    const ssr = window._SSR_DATA_ || window.__INITIAL_STATE__;
    const videoData = ssr?.anyVideo?.videoInfo?.video || ssr?.videoData;
    if (videoData?.playInfo?.url) {
      realStreamUrl = videoData.playInfo.url;
    } else if (Array.isArray(videoData?.playInfo?.url_list)) {
      realStreamUrl = videoData.playInfo.url_list[0];
    }
  } catch (e) {}

  return {
    platform: "ixigua",
    url: location.href,
    type: "video",
    title,
    author: author ? { name: author } : undefined,
    publishTime,
    cover,
    body: desc,
    media: realStreamUrl
      ? [{ url: realStreamUrl, quality: "default", type: "video" }]
      : (videoSrc.startsWith("http") ? [{ url: videoSrc, quality: "default", type: "video" }] : []),
    extractedAt: new Date().toISOString(),
  };
}
```

## 注意点

- **作者提取**：优先取 `a[href*='/user/']` 的文本作为作者名；`(?:记者|作者|编辑)\s+(\S{1,6})` innerText 正则仅作兜底，且需排除"关注/粉丝"等按钮词——真实页面"作者"标签旁紧跟"关注"按钮，正则会误捕。
- **域名判断**：URL 含 `ixigua.com` 走视频提取器，含 `toutiao.com/article` 走文章提取器。如果含 `/video/` 也走视频提取器。
- **移动版 vs PC 版**：移动版（`m.toutiao.com` / `m.ixigua.com`）DOM 更简单更稳定，如果 PC 版提取失败，可以尝试替换 URL 加 `m.` 前缀重试。
- **视频流地址**：西瓜视频流地址在 `_SSR_DATA_` 里相对抖音容易拿，但同样可能需要签名。blob URL 不返回。
- **登录墙**：头条系内容通常无需登录即可查看，但有时会弹"打开 App"遮罩。如果检测到 `.open-app-mask` 或类似元素，可以滚动避开或直接读 DOM（数据其实已加载）。
