# Zhihu Extractor

知乎主要有三类内容：问答页（`zhihu.com/question/{id}/answer/{id}`）、专栏文章（`zhuanlan.zhihu.com/p/{id}`）、想法/短内容（`zhihu.com/pin/{id}`）。问答页的答案数据有时在 `window.initialData` 里，专栏文章是 SSR。

## 路由

- `zhihu.com/question/{qid}/answer/{aid}` -> 问答答案页
- `zhihu.com/question/{qid}` -> 问题页（含多个答案，提取最高赞或第一个）
- `zhuanlan.zhihu.com/p/{id}` -> 专栏文章
- `zhihu.com/pin/{id}` -> 想法（短内容）

## 等待条件

```js
await browser_wait_for({ time: 3 });
// 问答页等 .AnswerItem 或 .Post-RichText
// 专栏页等 .Post-Title
```

## 问答页提取器

```js
() => {
  const questionTitle =
    document.querySelector(".QuestionHeader-title")?.textContent?.trim()
    || document.querySelector("h1.QuestionHeader-title")?.textContent?.trim()
    || document.title;

  // 第一个答案（通常是最高赞）
  const answerEl =
    document.querySelector(".AnswerItem")
    || document.querySelector(".Post-RichTextContainer")
    || document.querySelector("[class*='RichText']");

  const answerAuthor =
    document.querySelector(".AuthorInfo-name")?.textContent?.trim()
    || document.querySelector("[class*='AuthorInfo'] a")?.textContent?.trim();
  const authorUrl =
    document.querySelector(".AuthorInfo-name a")?.href
    || document.querySelector("[class*='AuthorInfo'] a")?.href
    || "";

  const rawBodyRaw = answerEl?.innerText?.trim() || "";
  // 知乎文本里常夹带零宽空格 (\u200b) 等不可见字符，先 strip 再处理
  const rawBody = rawBodyRaw.replace(/[\u200b\u200c\u200d\uFEFF]/g, "").trim();
  const bodyHtml = answerEl?.innerHTML || "";

  // 正文清洗：去掉末尾操作栏噪声
  // 知乎答案底部固定模式："赞同 1537\n70 条评论\n185\n446\n分享"
  const cleanPattern = /\n赞同 \d+\s*\n\s*\d+ 条评论\s*(?:\n\s*\d+\s*)*(?:\n.*?分享)?\s*$/s;
  const body = rawBody.replace(cleanPattern, "").trim();

  // 统计 - 从原始正文末尾正则提取（不依赖 DOM 选择器，知乎 class 常变）
  // 注意：文本里数字间常有空行（双换行），正则用 \s+ 处理
  const upvotesMatch = rawBody.match(/赞同\s+(\d+)/);
  const commentsMatch = rawBody.match(/(\d+)\s*条评论/);
  // 收藏数 + 喜欢数：位于"条评论"后和"分享"前，形如 "\n185\n446\n分享"
  const favMatch = rawBody.match(/\d+ 条评论\s*\n+\s*(\d+)\s*\n+\s*(\d+)\s*\n+.*?分享/);
  const upvotes = upvotesMatch ? upvotesMatch[1] : undefined;
  const comments = commentsMatch ? commentsMatch[1] : undefined;
  const favorites = favMatch ? favMatch[1] : undefined;
  const likes = favMatch ? favMatch[2] : undefined;

  // 发布时间 - 答案底部
  const publishTime =
    document.querySelector(".ContentItem-time")?.textContent?.trim()
    || document.querySelector("[class*='time']")?.textContent?.trim();

  // 封面 - 知乎问题页通常无封面，取正文第一张图
  const firstImg = answerEl?.querySelector("img")?.src || "";

  return {
    platform: "zhihu",
    url: location.href,
    type: "answer",
    questionTitle,
    title: questionTitle,
    author: answerAuthor ? { name: answerAuthor, url: authorUrl } : undefined,
    publishTime,
    cover: firstImg,
    body: body.slice(0, 4000),
    bodyHtml: bodyHtml.slice(0, 20000),
    stats: {
      upvotes,
      comments,
      favorites,
      likes,
    },
    extractedAt: new Date().toISOString(),
  };
}
```

## 专栏文章提取器

专栏页 SSR，结构清晰：

```js
() => {
  const title =
    document.querySelector("h1.Post-Title")?.textContent?.trim()
    || document.querySelector(".Post-Title")?.textContent?.trim()
    || document.title;

  const author =
    document.querySelector(".AuthorInfo-name")?.textContent?.trim()
    || document.querySelector("[class*='Author'] a")?.textContent?.trim();
  const authorUrl =
    document.querySelector(".AuthorInfo-name a")?.href
    || document.querySelector("[class*='Author'] a")?.href
    || "";

  const publishTime =
    document.querySelector(".ContentItem-time")?.textContent?.trim()
    || document.querySelector("time")?.textContent?.trim()
    || document.querySelector("[class*='time']")?.textContent?.trim();

  const bodyEl =
    document.querySelector(".Post-RichText")
    || document.querySelector(".RichText");
  const rawBodyRaw = bodyEl?.innerText?.trim() || "";
  const rawBody = rawBodyRaw.replace(/[\u200b\u200c\u200d\uFEFF]/g, "").trim();
  const bodyHtml = bodyEl?.innerHTML || "";

  // 正文清洗：去掉末尾操作栏噪声
  const cleanPattern = /\n赞同 \d+\s*\n\s*\d+ 条评论\s*(?:\n\s*\d+\s*)*(?:\n.*?分享)?\s*$/s;
  const body = rawBody.replace(cleanPattern, "").trim();

  // 封面 - 专栏文章 og:image
  const cover =
    document.querySelector('meta[property="og:image"]')?.content
    || bodyEl?.querySelector("img")?.src
    || "";

  // 统计 - 从原始正文末尾正则提取
  const upvotesMatch = rawBody.match(/赞同\s+(\d+)/);
  const commentsMatch = rawBody.match(/(\d+)\s*条评论/);
  const favMatch = rawBody.match(/\d+ 条评论\s*\n+\s*(\d+)\s*\n+\s*(\d+)\s*\n+.*?分享/);
  const upvotes = upvotesMatch ? upvotesMatch[1] : undefined;
  const comments = commentsMatch ? commentsMatch[1] : undefined;
  const favorites = favMatch ? favMatch[1] : undefined;
  const likes = favMatch ? favMatch[2] : undefined;

  // 标题图列表
  const images = Array.from(bodyEl?.querySelectorAll("img") || [])
    .map(img => img.src || img.dataset.originalTag)
    .filter(url => url && url.startsWith("http"));

  return {
    platform: "zhihu",
    url: location.href,
    type: "article",
    title,
    author: author ? { name: author, url: authorUrl } : undefined,
    publishTime,
    cover,
    body: body.slice(0, 4000),
    bodyHtml: bodyHtml.slice(0, 20000),
    images: images.slice(0, 20),
    stats: {
      upvotes,
      comments,
      favorites,
      likes,
    },
    extractedAt: new Date().toISOString(),
  };
}
```

## 想法/短内容提取器

```js
() => {
  const content =
    document.querySelector(".RichText")?.innerText?.trim()
    || document.querySelector("[class*='PinItem'] [class*='RichText']")?.innerText?.trim()
    || "";

  const author =
    document.querySelector("[class*='AuthorInfo'] a")?.textContent?.trim();

  const publishTime =
    document.querySelector("[class*='time']")?.textContent?.trim();

  return {
    platform: "zhihu",
    url: location.href,
    type: "pin",
    title: content.slice(0, 50) + (content.length > 50 ? "..." : ""),
    author: author ? { name: author } : undefined,
    publishTime,
    body: content,
    extractedAt: new Date().toISOString(),
  };
}
```

## 注意点

- **统计提取策略**：知乎的 class 名经常用 CSS Modules 混淆（如 `VoteButton--up`、`ContentItem-time` 等），DOM 选择器不稳定。本提取器改为**从 `innerText` 末尾正则提取**统计数字，模式固定为 `赞同 \d+\n\d+ 条评论\n\d+\n\d+\n分享`，不依赖 DOM 选择器。同时**正文自动清洗**，去掉末尾操作栏噪声，用户看到的 body 是纯净内容。
- **问题页多条答案**：`/question/{qid}` 不带 `/answer/` 时是问题页，含多条答案。本 skill 默认只提取第一条（通常是最高赞同答案）。如果用户想看所有答案，提取器返回的 body 是第一条，需在卡片里注明"该页含 N 条答案，默认取首条"。
- **登录墙**：知乎频繁弹"扫码登录"遮罩，但内容其实已 SSR 加载。如果检测到登录遮罩，可以尝试用 JS 删除遮罩元素继续读，或直接读 `initialData` / 已加载 DOM。**不要**尝试绕过登录去看付费内容。
- **`window.initialData`**：知乎把页面初始数据塞在 `window.initialData`，包含问题、答案列表、作者信息等。如果 DOM 提取失败，可以尝试从 `initialData` 解析：
  ```js
  const d = window.initialData || {};
  const q = d.initialState?.entities?.questions?.[qid];
  const answers = d.initialState?.entities?.answers || {};
  ```
- **多条答案**：`/question/{qid}` 不带 `/answer/` 时是问题页，含多条答案。本 skill 默认只提取第一条（通常是最高赞）。如果用户想看所有答案，可以让 SKILL.md 提示"该页含 N 条答案，默认取首条，如需更多请说明"。
- **专栏图片**：专栏文章的图片常带 `data-original` 原图地址（防盗链），如果 `img.src` 是缩略图，可读 `data-original`。
