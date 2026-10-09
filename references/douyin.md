# Douyin Extractor

抖音分享链接通常以 `v.douyin.com/xxxxx/` 形式出现，需先 navigate 一次跟随跳转到 `www.douyin.com/video/xxx` 或 `www.iesdouyin.com/share/video/xxx`。

## ⚠️ 重要：选择器策略

抖音前端**经常移除/重命名 `data-e2e` 属性**，class 名也用 CSS Modules 混淆过。**不要依赖 `[data-e2e="..."]` 或 class 选择器**--它们在任何一次前端发版后都可能失效。

本提取器采用 **`innerText` 文本提取策略**：无论 DOM 结构怎么变，用户在页面上看到的文字内容是稳定的。通过正则匹配 `document.body.innerText` 里的稳定文本模式（如"发布时间："、"粉丝XX万获赞XX万"）来提取数据，比 CSS 选择器可靠得多。

## 路由

- `v.douyin.com/xxx` -> 短链，先 navigate 拿到最终 URL
- `www.douyin.com/video/{id}` -> 视频
- `www.iesdouyin.com/share/video/{id}` -> 移动分享页（结构更简单，推荐）

## 等待条件

抖音 SPA 加载慢，建议等 4-5s 或等 `<video>` 标签：

```js
await browser_wait_for({ time: 4 });
// 或
await browser_evaluate({ function: "() => !!document.querySelector('video')" });
```

## 提取器函数

```js
() => {
  const text = document.body.innerText;

  // 0. 前置守卫：视频不存在 / 页面未渲染视频信息时直接返回 ErrorResult，
  //    避免拿页脚备案号等噪声当数据
  const h1El = document.querySelector('h1');
  if (/你要观看的视频不存在|视频不存在/.test(text)
    || (!h1El && /^在抖音记录美好生活/.test(document.title.replace(/ - 抖音$/, "")))) {
    return {
      platform: 'douyin',
      url: location.href,
      error: 'VIDEO_NOT_FOUND',
      message: '视频不存在、已删除，或页面未渲染出视频信息。',
      extractedAt: new Date().toISOString(),
    };
  }

  // 1. 标题 - h1 最可靠，document.title 兜底
  const h1 = document.querySelector('h1');
  const title = h1?.textContent?.trim() || document.title.replace(/ - 抖音$/, "");

  // 2. 作者 - img[alt] 找作者头像（排除 icon/图片/logo 等无关注图）
  const authorImgs = Array.from(document.querySelectorAll('img[alt]'));
  const authorImg = authorImgs.find(img => {
    const alt = img.alt?.trim();
    return alt && alt.length > 1 && !/^(icon|图片|logo)$/i.test(alt);
  });
  const authorName = authorImg?.alt?.trim();
  const authorLink = document.querySelector('a[href*="/user/MS4"]');
  const authorUrl = authorLink?.href || "";

  // 3. 粉丝/获赞 - "粉丝63.3万获赞241.0万" 格式（万? 兼容不带"万"的小数字）
  const fansMatch = text.match(/粉丝([\d.]+万?)获赞([\d.]+万?)/);

  // 4. 统计数字 - 只在"视频信息区"内取数，绝不抓页脚备案号：
  //    信息区 = "发布时间"之前的文本（页脚备案号都在发布时间之后，天然排除）；
  //    信息区文本模式："标题\n点赞数\n评论数\n收藏数\n分享数\n举报\n发布时间：..."
  //    注：评论/收藏/分享为 0 时抖音不渲染数字（只显示"抢首评/收藏/分享"），取不到留空
  let likes, comments, collects, shares;
  const numLine = /^\d[\d.]*万?$/;
  const timeIdx = text.indexOf('发布时间');
  const reportIdx = timeIdx > 0 ? text.lastIndexOf('举报', timeIdx) : -1;
  if (reportIdx > 0) {
    const before = text.slice(Math.max(0, reportIdx - 150), reportIdx);
    // 方案 A：四个连续纯数字行（最稳定）
    const statsMatch = before.match(/(\d+)\s*\n\s*(\d+)\s*\n\s*(\d+)\s*\n\s*(\d+)\s*\n?\s*$/);
    if (statsMatch) {
      [likes, comments, collects, shares] = [statsMatch[1], statsMatch[2], statsMatch[3], statsMatch[4]];
    } else {
      // 方案 B：按行逐字段取数
      //   点赞数 = 第一个按钮标签（抢首评/评论）前相邻的纯数字行
      //   评论数 = "N 条评论" 内嵌数字（"抢首评" 表示 0，留空）
      //   收藏/分享数 = 按钮标签行内数字，未渲染则留空
      const lines = before.split('\n').map(l => l.trim()).filter(Boolean);
      const firstBtnIdx = lines.findIndex(l => /^(抢首评|评论|\d+\s*条评论)/.test(l));
      if (firstBtnIdx > 0 && numLine.test(lines[firstBtnIdx - 1])) {
        likes = lines[firstBtnIdx - 1];
      }
      const findNum = (re) => {
        const l = lines.find(l => re.test(l));
        const m = l?.match(/(\d[\d.]*万?)/);
        return m ? m[1] : undefined;
      };
      comments = findNum(/条评论/) || undefined;
      collects = findNum(/^\s*收藏\s*[\d.]/) || undefined;
      shares = findNum(/^\s*分享\s*[\d.]/) || undefined;
    }
  }

  // 5. 发布时间 - "发布时间：2026-07-29 17:56" 格式
  const timeMatch = text.match(/发布时间[：:]\s*([\d\-]+ [\d:]+)/);

  // 6. AI 章节摘要 - 抖音有时生成"章节要点"后的长文本摘要
  //    特征：出现在"章节要点"文字之后，是连续的长段落（>50字）
  let aiSummary = "";
  if (text.includes("章节要点")) {
    // 取"章节要点"后到第一个章节时间点（如"00:00\n引言"）之间的文本
    const m = text.match(/章节要点\s*\n([\s\S]*?)(?=\n\d{2}:\d{2}\n)/);
    if (m) aiSummary = m[1].trim();
  }

  // 7. 视频章节列表 - 仅在"章节要点"区域提取，避免误匹配播放器进度/评论区/推荐视频
  //    策略：先定位"章节要点"文本，在其祖先容器里提取 "00:00\n引言" 模式
  let chapters = [];
  const chapterEl = Array.from(document.querySelectorAll('div')).find(
    d => d.textContent?.trim() === '章节要点' && d.children.length === 0
  );
  if (chapterEl) {
    // 向外找最多 3 层，直到找到包含多个 \d{2}:\d{2} 的容器
    let chapterContainer = chapterEl.parentElement;
    for (let i = 0; i < 3 && chapterContainer; i++) {
      const timeCount = (chapterContainer.innerText.match(/\d{2}:\d{2}/g) || []).length;
      if (timeCount >= 2) break;
      chapterContainer = chapterContainer.parentElement;
    }
    if (chapterContainer) {
      const chapterText = chapterContainer.innerText;
      const chapterPattern = /(\d{2}:\d{2})\n([^\n]+)/g;
      let cm;
      while ((cm = chapterPattern.exec(chapterText)) && chapters.length < 20) {
        const [, time, name] = cm;
        // 章节名排除：含 "/"（播放进度）、含"评论"、长度异常
        if (!name.includes('/') && !name.includes('评论') && name.length < 30) {
          chapters.push({ time, name: name.trim() });
        }
      }
    }
  }
  // 去重（同一章节可能出现多次）
  const seen = new Set();
  chapters = chapters.filter(c => {
    if (seen.has(c.time + c.name)) return false;
    seen.add(c.time + c.name);
    return true;
  });

  // 8. 封面 - og:image 通常为空，video.poster 也常空，尽力取
  const cover =
    document.querySelector('meta[property="og:image"]')?.content
    || document.querySelector('video')?.poster
    || "";

  // 9. 视频流 - blob URL，不可直接下载
  const videoEl = document.querySelector('video');
  const videoSrc = videoEl?.src || "";
  const isBlob = videoSrc.startsWith('blob:');

  // 10. 尝试从 RENDER_DATA 拿真实流地址（可能被加密，尽力而为）
  let realStreamUrl = "";
  try {
    const renderData = document.getElementById('RENDER_DATA')?.textContent;
    if (renderData) {
      const decoded = decodeURIComponent(renderData);
      const m = decoded.match(/"(?:playAddr|play_addr|playApi)":\s*"?([^",}]+)/);
      if (m) realStreamUrl = m[1];
    }
  } catch (e) {}

  return {
    platform: 'douyin',
    url: location.href,
    type: 'video',
    title,
    author: authorName ? { name: authorName, url: authorUrl } : undefined,
    publishTime: timeMatch ? timeMatch[1] : undefined,
    cover,
    body: aiSummary || undefined,
    chapters: chapters.length > 0 ? chapters : undefined,
    stats: {
      likes: likes || undefined,
      comments: comments || undefined,
      collects: collects || undefined,
      shares: shares || undefined,
    },
    fansInfo: fansMatch ? { fans: fansMatch[1], totalLikes: fansMatch[2] } : undefined,
    media: realStreamUrl ? [{ url: realStreamUrl, quality: 'default', type: 'video' }] : [],
    extra: {
      videoSrcIsBlob: isBlob,
      note: isBlob ? '视频流为 blob URL，无法直接下载。真实流地址需调 playUrl 接口（需 cookie/签名）。' : undefined,
    },
    extractedAt: new Date().toISOString(),
  };
}
```

## 注意点

- **选择器策略**：抖音前端**经常移除/重命名 `data-e2e` 属性**，class 名也用 CSS Modules 混淆过。本提取器用 `innerText` 正则 + `h1`/`img[alt]` 等稳定锚点，不依赖易变的属性选择器。如果仍提取失败，回退到 generic OG meta 兜底。
- **统计数字提取的脆弱性**：只在"视频信息区"（`发布时间` 之前的文本）内取数，页脚备案号等噪声天然排除。方案 A 匹配四个连续纯数字行；方案 B 按行逐字段取数——点赞数取"抢首评/评论"按钮前相邻的纯数字行，评论数取"N 条评论"内嵌数字。如果抖音改版把统计数字打散、加了图标，或改用"1.2万"缩写显示，可能只拿到部分字段或顺序错乱，取不到的字段留空（undefined），但不会塞无关数字。评论/收藏/分享为 0 时抖音前端不渲染数字（只显示"抢首评/收藏/分享"），这些字段留空属正常。
- **视频不存在的前置守卫**：视频删除/失效时页面显示"你要观看的视频不存在"（h1 缺失、标题为站点默认标题），提取器入口直接返回 `error: "VIDEO_NOT_FOUND"` 的 ErrorResult，不再继续提取。
- **视频流地址**：抖音的 `<video>.src` 是 `blob:https://...`，不能直接下载。真实 mp4 地址藏在 `RENDER_DATA`（URI 编码的 JSON）或动态接口里，且接口需要 `_signature` 参数。在已登录浏览器里 `RENDER_DATA` 有时能直接拿到 `play_addr.url_list[0]`，但经常被加密。本 skill 在拿不到时返回空 `media` 数组，并在 `extra.note` 里说明原因。
- **iesdouyin.com 分享页**结构更老更稳定，如果遇到 `www.iesdouyin.com/share/video/`，DOM 更简单（`.video-info`、`.author` 等），但用户量少。
- **登录墙**：如果 navigate 后 URL 含 `/login` 或页面显示"扫码登录"，按 SKILL.md 的 "When to stop and ask" 处理。注意：抖音视频页**未登录也能看内容**，但评论区会显示"请先登录后发表评论"--这不影响提取，提取的是视频本身的数据。
- **反爬验证码**：抖音经常弹滑块验证。遇到验证码 DOM（`#captcha` 等）时停止并告诉用户。
- **AI 章节摘要**是抖音 PC 端的新功能，不是所有视频都有。没有时 `body` 为 undefined，不影响其他字段。
