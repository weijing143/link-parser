# WeChat Official Account Article Extractor

微信公众号文章 URL 格式固定为 `mp.weixin.qq.com/s/xxx` 或 `mp.weixin.qq.com/s?__biz=...&mid=...&idx=...&sn=...`。文章是 SSR 静态 HTML，DOM 结构多年稳定，是最容易解析的平台之一。

## 路由

- `mp.weixin.qq.com/s/xxxx` -> 文章
- `mp.weixin.qq.com/s?__biz=...` -> 文章（带参数）
- `url.cn/xxx` -> 微信短链，需先 navigate 跟随跳转

## 等待条件

公众号文章是 SSR，等 DOMContentLoaded 即可。但 `#js_content` 内的图片是懒加载，需要滚动触发：

```js
await browser_wait_for({ text: "分享" }); // 或简单等待
await browser_wait_for({ time: 2 });

// 滚动触发图片懒加载
await browser_evaluate({
  function: "() => window.scrollTo(0, document.body.scrollHeight)"
});
await browser_wait_for({ time: 1 });
await browser_evaluate({ function: "() => window.scrollTo(0, 0)" });
```

## 提取器函数

公众号文章结构稳定，主要靠 `#js_content`、`#js_name`、`#js_author` 等固定 ID：

```js
() => {
  // 前置守卫：内容删除/违规 -> DELETED；无正文容器 -> NO_CONTENT
  const pageText = document.body?.innerText || "";
  if (/该内容已被发布者删除|此内容因违规无法查看/.test(pageText)) {
    return {
      platform: "wechat",
      url: location.href,
      error: "DELETED",
      message: "内容已被发布者删除或因违规无法查看。",
      extractedAt: new Date().toISOString(),
    };
  }
  if (!document.getElementById("js_content")) {
    return {
      platform: "wechat",
      url: location.href,
      error: "NO_CONTENT",
      message: "未找到正文容器 #js_content，可能是临时链接过期或页面结构改版。",
      extractedAt: new Date().toISOString(),
    };
  }

  // 标题 - 注意：#js_name 是公众号名称，不是文章标题！
  // 文章标题在 #activity-name 或 og:title 里
  const title =
    document.getElementById("activity-name")?.textContent?.trim()
    || document.querySelector('meta[property="og:title"]')?.content
    || document.querySelector("h1")?.textContent?.trim()
    || document.title;

  // 作者/公众号名（#js_name 是公众号名，用于 author 字段）
  const authorName =
    document.getElementById("js_name")?.textContent?.trim()
    || document.querySelector(".profile_nickname")?.textContent?.trim()
    || "";

  // 原创作者（底部）
  const originalAuthor =
    document.querySelector("#js_author_name")?.textContent?.trim()
    || document.querySelector(".rich_media_meta_text")?.textContent?.trim();

  // 发布时间
  const publishTime =
    document.getElementById("js_article_show_time")?.textContent?.trim()
    || document.querySelector("#publish_time")?.textContent?.trim()
    || document.querySelector(".rich_media_meta_text em")?.textContent?.trim();

  // 正文 HTML 和纯文本
  const contentEl = document.getElementById("js_content");
  const bodyHtml = contentEl?.innerHTML || "";
  const body = contentEl?.innerText?.trim() || "";

  // 封面
  const cover =
    document.querySelector('meta[property="og:image"]')?.content
    || document.querySelector('meta[name="og:image"]')?.content
    || "";

  // 描述
  const desc =
    document.querySelector('meta[name="description"]')?.content
    || document.querySelector('meta[property="og:description"]')?.content
    || "";

  // 文章内图片列表 - 排除文章 URL 本身（mp.weixin.qq.com/s/）等非图片链接
  const images = Array.from(
    contentEl?.querySelectorAll("img") || []
  )
    .map(img => img.dataset.src || img.src)
    .filter(url => url && url.startsWith("http"))
    .filter(url => !url.includes("mp.weixin.qq.com/s/"))  // 排除文章 URL
    .filter(url => !url.includes("data:image/"))            // 排除 base64 占位图
    .filter((url, i, arr) => arr.indexOf(url) === i); // 去重

  // 统计 - 公众号文章页通常不显示阅读数（需扫码登录后端），DOM 里一般没有
  // 如果有 #js_like_count / #js_read_num 则读取
  const getText = (sel) => document.querySelector(sel)?.textContent?.trim();
  const likes = getText("#js_like_count") || getText(".like_num");
  const reads = getText("#js_read_num") || getText(".read_num");

  // 原创标记
  const isOriginal = !!document.querySelector("#js_content .original_panel")
    || !!document.querySelector(".weui-icon-original");

  return {
    platform: "wechat",
    url: location.href,
    type: "article",
    title,
    author: {
      name: authorName || undefined,
      url: location.href,
    },
    originalAuthor,
    publishTime,
    cover,
    description: desc,
    body: body.slice(0, 4000),
    bodyHtml: bodyHtml.slice(0, 20000), // 可选，便于二次处理
    images: images.slice(0, 20),
    isOriginal,
    stats: {
      likes: likes || undefined,
      reads: reads || undefined,
    },
    extractedAt: new Date().toISOString(),
  };
}
```

## 注意点

- **前置守卫（ErrorResult）**：页面文本命中"该内容已被发布者删除/此内容因违规无法查看"返回 `error: "DELETED"`；无 `#js_content` 返回 `error: "NO_CONTENT"`（常见于临时链接过期），让 SKILL.md 走 generic 兜底。
- **`#js_name` 是公众号名，不是文章标题**：早期版本的提取器误把 `#js_name` 当 title，导致返回的 `title` 是公众号名（如"新智元"）而非文章标题。正确做法：title 用 `#activity-name` 或 `og:title`，`#js_name` 只用于 author 字段。
- **图片 URL 过滤**：页面里某些 `<img>` 的 `src`/`data-src` 可能被设成文章 URL（`mp.weixin.qq.com/s/...`）或 base64 占位图，需过滤掉，否则 `images` 数组会混入非图片 URL。
- **DOM 稳定性**：公众号文章页用 `#js_*` ID 命名，多年来非常稳定，是各平台里最可靠的。
- **图片懒加载**：`<img>` 的真实地址在 `data-src` 里，不是 `src`。上面代码已处理。
- **阅读数**：公众号文章前台一般看不到阅读数，需要登录后端"图文分析"。如果 DOM 里没有，`stats.reads` 设为 undefined，不要硬找。
- **临时链接**：`mp.weixin.qq.com/s?temp=` 这类临时分享链接有时效，过期会跳转到提示页。如果提取到 title 为空且 body 为空，可能是链接过期。
- **视频号引用**：文章里嵌入的视频号视频用 `<iframe>` 或 `<mpvoice>` 等标签，不在本 skill 范围内 - 标记为 "嵌入视频号" 即可，不提取流地址。
