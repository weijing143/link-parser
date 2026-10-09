// Offline fixture tests for extractors, with assertions. Builds representative
// DOM in Chromium via page.setContent and runs the real extractor functions
// from references/*.md against it. Used when live testing is blocked by
// WAF/anti-bot (bilibili, zhihu) and as regression protection for fixed bugs
// (douyin stats / VIDEO_NOT_FOUND, toutiao author).
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getExtractorSource } from "./extractors.mjs";

const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "results");
mkdirSync(OUT_DIR, { recursive: true });

const results = {};
const failures = [];

function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS ${name}`);
  } else {
    failures.push(name);
    console.log(`FAIL ${name} :: ${detail}`);
  }
}

// ---------- Bilibili fixture ----------
const biliState = {
  videoData: {
    bvid: "BV1TEST00000001",
    aid: 114514,
    title: "测试视频标题 Fixture Video",
    desc: "这是一个测试简介。",
    pic: "https://i0.hdslb.com/bfs/archive/test.jpg",
    pubdate: 1700000000,
    duration: 754, // 12:34
    cid: 123456,
    tid: 21,
    tname: "日常",
    owner: { name: "测试UP主", mid: 10086 },
    stat: {
      view: 1234567, danmaku: 8901, like: 23456, coin: 3456,
      favorite: 4567, reply: 567, share: 78,
    },
    pages: [
      { part: "P1 开头", duration: 300 },
      { part: "P2 高潮", duration: 454 },
    ],
  },
  tags: [{ tag_name: "测试" }, { tag_name: "fixture" }],
};

const biliHtml = `<!DOCTYPE html><html><head><meta property="og:image" content="https://example.com/og.jpg"><title>fixture</title></head>
<body><video src="blob:https://www.bilibili.com/abc"></video>
<script>window.__INITIAL_STATE__ = ${JSON.stringify(biliState)};</script>
</body></html>`;

// ---------- Zhihu fixture ----------
const zhihuHtml = `<!DOCTYPE html><html><head><title>fixture zhihu</title></head><body>
<h1 class="QuestionHeader-title">如何评价测试驱动的开发？</h1>
<div class="QuestionHeader-detail"></div>
<div class="AnswerItem" data-aid="1">
  <div class="AuthorInfo">
    <a class="AuthorInfo-name" href="https://www.zhihu.com/people/test-user">测试答主</a>
  </div>
  <div class="RichText">
    <p>这是答案正文第一段，介绍 TDD 的基本概念。</p>
    <p>这是第二段，包含一些细节和例子。</p>
  </div>
  <div class="ContentItem-actions">
    <div><button>赞同 1537</button></div>
    <div><span>70 条评论</span></div>
    <div><button>185</button></div>
    <div><button>446</button></div>
    <div><button>分享</button></div>
  </div>
</div>
</body></html>`;

// ---------- Douyin fixtures (regression for stats / VIDEO_NOT_FOUND fixes) ----------
// Valid video page: action bar renders likes "1", then 抢首评/收藏/分享 buttons
// with no numbers (0 comments/collects/shares), then 举报 + 发布时间.
// Footer license numbers must NOT leak into stats.
const douyinValidHtml = `<!DOCTYPE html><html><head>
<title>#ootd穿搭 #扭一扭 - 抖音</title>
<meta property="og:image" content="">
</head><body>
<h1>#ootd穿搭 #扭一扭 #遮肉显瘦</h1>
<img alt="icon" src="x">
<img alt="慕禾百货店" src="avatar">
<a href="https://www.douyin.com/user/MS4wLjABAAAAtest">作者</a>
<div class="info">
  <div>1</div>
  <div>抢首评</div>
  <div>收藏</div>
  <div>分享</div>
  <div>举报</div>
  <div>发布时间：2025-06-25 21:45</div>
</div>
<div class="footer" style="position:absolute;left:-9999px">
  <div>（京）网药械网络信息服务备字（2023）第00570号</div>
  <div>互联网新闻信息服务许可证 11220230001</div>
  <div>违法和不良信息举报</div>
</div>
</body></html>`;

// Deleted video page: "你要观看的视频不存在", no h1, default site title
const douyinDeletedHtml = `<!DOCTYPE html><html><head><title>在抖音记录美好生活20261009 - 抖音</title></head><body>
<p>你要观看的视频不存在</p>
<div class="footer">京ICP备16016397号-3</div>
</body></html>`;

// ---------- Toutiao fixture (regression for author fix) ----------
// "作者" label is followed by the Follow button; the real author name lives in
// the a[href*='/user/'] text.
const toutiaoHtml = `<!DOCTYPE html><html><head><title>首次"官宣" - 今日头条</title></head><body>
<h1>首次"官宣"和居民端"主动缩表"</h1>
<div class="author-bar">
  <span>作者</span>
  <a href="https://www.toutiao.com/c/user/token/MS4wLjABAAAAylhi/?source=tuwen_detail">熊猫贝贝小可爱</a>
  <button>关注</button>
</div>
<p>原创2022-08-04 21:09</p>
<article class="syl-article-base">
  <p>这是正文第一段，关于经济的讨论。</p>
  <p>这是正文第二段，包含更多细节和论据。</p>
</article>
</body></html>`;

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext()).newPage();
  // setContent() reuses the same Window (document.open/write), so globals like
  // window.__INITIAL_STATE__ leak between fixtures — force a real navigation first.
  const load = async (html) => {
    await page.goto("about:blank");
    await page.setContent(html, { waitUntil: "load" });
  };

  // Bilibili: matching BV
  await load(biliHtml, { waitUntil: "load" });
  const biliSrc = getExtractorSource("bilibili");
  results.bilibili_fixture_match = await page.evaluate(`(${biliSrc})("BV1TEST00000001")`);
  check("bilibili: title", results.bilibili_fixture_match.title === "测试视频标题 Fixture Video", results.bilibili_fixture_match.title);
  check("bilibili: duration 12:34", results.bilibili_fixture_match.duration === "12:34", results.bilibili_fixture_match.duration);
  check("bilibili: author name", results.bilibili_fixture_match.author?.name === "测试UP主", JSON.stringify(results.bilibili_fixture_match.author));
  check("bilibili: stats.views", results.bilibili_fixture_match.stats?.views === "1234567", JSON.stringify(results.bilibili_fixture_match.stats));
  check("bilibili: parts>=2", (results.bilibili_fixture_match.parts || []).length === 2, JSON.stringify(results.bilibili_fixture_match.parts));

  // Bilibili: mismatched BV -> expect AUTO_PLAY_SWITCHED ErrorResult
  results.bilibili_fixture_mismatch = await page.evaluate(`(${biliSrc})("BV1OTHER0000002")`);
  check("bilibili: AUTO_PLAY_SWITCHED", results.bilibili_fixture_mismatch.error === "AUTO_PLAY_SWITCHED", JSON.stringify(results.bilibili_fixture_mismatch));

  // Zhihu: answer page fixture
  await load(zhihuHtml, { waitUntil: "load" });
  const zhihuSrc = getExtractorSource("zhihu");
  results.zhihu_fixture = await page.evaluate(`(${zhihuSrc})()`);
  check("zhihu: title", results.zhihu_fixture.title === "如何评价测试驱动的开发？", results.zhihu_fixture.title);
  check("zhihu: stats", results.zhihu_fixture.stats?.upvotes === "1537" && results.zhihu_fixture.stats?.comments === "70", JSON.stringify(results.zhihu_fixture.stats));
  check("zhihu: body cleaned (no 赞同/分享 tail)", !/赞同|条评论|分享/.test(results.zhihu_fixture.body || ""), results.zhihu_fixture.body);

  // Douyin: valid video -> stats from info region only, footer numbers excluded
  await load(douyinValidHtml, { waitUntil: "load" });
  const douyinSrc = getExtractorSource("douyin");
  results.douyin_fixture_valid = await page.evaluate(`(${douyinSrc})()`);
  const dv = results.douyin_fixture_valid;
  check("douyin: no error on valid page", !dv.error, JSON.stringify(dv.error));
  check("douyin: author from img[alt]", dv.author?.name === "慕禾百货店", JSON.stringify(dv.author));
  check("douyin: likes=1", dv.stats?.likes === "1", JSON.stringify(dv.stats));
  check("douyin: comments/collects/shares omitted (0 not rendered)", dv.stats?.comments === undefined && dv.stats?.collects === undefined && dv.stats?.shares === undefined, JSON.stringify(dv.stats));
  check("douyin: no footer license numbers in stats", !/00570|11220230001/.test(JSON.stringify(dv.stats || {})), JSON.stringify(dv.stats));
  check("douyin: publishTime", dv.publishTime === "2025-06-25 21:45", dv.publishTime);

  // Douyin: deleted video -> VIDEO_NOT_FOUND ErrorResult
  await load(douyinDeletedHtml, { waitUntil: "load" });
  results.douyin_fixture_deleted = await page.evaluate(`(${douyinSrc})()`);
  const dd = results.douyin_fixture_deleted;
  check("douyin: VIDEO_NOT_FOUND", dd.error === "VIDEO_NOT_FOUND", JSON.stringify(dd));
  check("douyin: ErrorResult has platform/url/extractedAt", dd.platform === "douyin" && !!dd.url && !!dd.extractedAt, JSON.stringify(dd));

  // Toutiao: author from a[href*='/user/'], not the "关注" button
  await load(toutiaoHtml, { waitUntil: "load" });
  const toutiaoSrc = getExtractorSource("toutiao");
  results.toutiao_fixture = await page.evaluate(`(${toutiaoSrc})()`);
  const tt = results.toutiao_fixture;
  check("toutiao: author from user link", tt.author?.name === "熊猫贝贝小可爱", JSON.stringify(tt.author));
  check("toutiao: author is not 关注", tt.author?.name !== "关注", JSON.stringify(tt.author));
  check("toutiao: publishTime", tt.publishTime === "2022-08-04 21:09", tt.publishTime);
  check("toutiao: body from article", /正文第一段/.test(tt.body || ""), tt.body);

  // ---------- Guard fixtures (regression for NO_STATE/WALL/NO_ANSWER/NO_CONTENT) ----------
  // Bilibili: risk-control wall page -> WALL (checked before NO_STATE)
  await load(`<!DOCTYPE html><html><head><title>安全验证</title></head><body><p>请完成安全验证后继续访问</p></body></html>`, { waitUntil: "load" });
  results.bilibili_fixture_wall = await page.evaluate(`(${biliSrc})("BV1TEST00000001")`);
  check("bilibili: WALL", results.bilibili_fixture_wall.error === "WALL", JSON.stringify(results.bilibili_fixture_wall));
  check("bilibili: WALL ErrorResult shape", results.bilibili_fixture_wall.platform === "bilibili" && !!results.bilibili_fixture_wall.url && !!results.bilibili_fixture_wall.extractedAt, JSON.stringify(results.bilibili_fixture_wall));

  // Bilibili: error page without __INITIAL_STATE__ -> NO_STATE
  await load(`<!DOCTYPE html><html><head><title>出错啦! - bilibili.com</title></head><body><p>出错啦!</p></body></html>`, { waitUntil: "load" });
  results.bilibili_fixture_nostate = await page.evaluate(`(${biliSrc})("BV1TEST00000001")`);
  check("bilibili: NO_STATE", results.bilibili_fixture_nostate.error === "NO_STATE", JSON.stringify(results.bilibili_fixture_nostate));

  // Bilibili: normal page must NOT trigger WALL (logged-out header has 登录 button etc.)
  check("bilibili: normal page no WALL/NO_STATE", !results.bilibili_fixture_match.error, JSON.stringify(results.bilibili_fixture_match.error));

  // Zhihu answer: no answer container -> NO_ANSWER
  const zhihuArticleSrc = getExtractorSource("zhihu", "article");
  const zhihuPinSrc = getExtractorSource("zhihu", "pin");
  await load(`<!DOCTYPE html><html><head><title>页面不存在 - 知乎</title></head><body><h1>你似乎来到了没有知识的荒原</h1><div class="Recommendations">推荐内容</div></body></html>`, { waitUntil: "load" });
  results.zhihu_fixture_no_answer = await page.evaluate(`(${zhihuSrc})()`);
  check("zhihu: NO_ANSWER", results.zhihu_fixture_no_answer.error === "NO_ANSWER", JSON.stringify(results.zhihu_fixture_no_answer));
  check("zhihu: NO_ANSWER ErrorResult shape", results.zhihu_fixture_no_answer.platform === "zhihu" && !!results.zhihu_fixture_no_answer.url && !!results.zhihu_fixture_no_answer.extractedAt, JSON.stringify(results.zhihu_fixture_no_answer));

  // Zhihu article: no .Post-RichText and no initialData -> NO_CONTENT
  await load(`<!DOCTYPE html><html><head><title>404 - 知乎专栏</title></head><body><h1 class="Post-Title">不存在</h1></body></html>`, { waitUntil: "load" });
  results.zhihu_fixture_no_content = await page.evaluate(`(${zhihuArticleSrc})()`);
  check("zhihu: NO_CONTENT (article)", results.zhihu_fixture_no_content.error === "NO_CONTENT", JSON.stringify(results.zhihu_fixture_no_content));

  // Zhihu article: no .Post-RichText but initialData present -> must NOT error
  await load(`<!DOCTYPE html><html><head><title>专栏</title></head><body><h1 class="Post-Title">标题</h1><script>window.initialData = {initialState:{}};</script></body></html>`, { waitUntil: "load" });
  results.zhihu_fixture_article_initialdata = await page.evaluate(`(${zhihuArticleSrc})()`);
  check("zhihu: article with initialData does not error", !results.zhihu_fixture_article_initialdata.error, JSON.stringify(results.zhihu_fixture_article_initialdata.error));

  // Zhihu pin: empty content -> NO_CONTENT
  await load(`<!DOCTYPE html><html><head><title>想法 - 知乎</title></head><body><div class="PinItem"><div class="AuthorInfo"><a>某人</a></div></div></body></html>`, { waitUntil: "load" });
  results.zhihu_fixture_pin_no_content = await page.evaluate(`(${zhihuPinSrc})()`);
  check("zhihu: NO_CONTENT (pin)", results.zhihu_fixture_pin_no_content.error === "NO_CONTENT", JSON.stringify(results.zhihu_fixture_pin_no_content));

  // ---------- Batch 3: adversarial-fix regression guards ----------
  // CRITICAL (defect 1): valid __INITIAL_STATE__.videoData + "请登录后发表评论"
  // in page text must still be a normal ParseResult, NOT WALL.
  await load(`<!DOCTYPE html><html><head><title>正常视频 - bilibili</title></head><body>
    <div class="comment-box">请登录后发表评论</div>
    <video src="blob:https://www.bilibili.com/x"></video>
    <script>window.__INITIAL_STATE__ = ${JSON.stringify(biliState)};</script>
  </body></html>`);
  results.bilibili_fixture_login_text = await page.evaluate(`(${biliSrc})("BV1TEST00000001")`);
  const bl = results.bilibili_fixture_login_text;
  check("bilibili: 请登录评论文本不误杀（无 error）", !bl.error, JSON.stringify(bl.error));
  check("bilibili: 请登录评论文本不误杀（title 正常）", bl.title === "测试视频标题 Fixture Video", bl.title);

  // Douyin: unhydrated valid page (has h1, no stats yet) must NOT be VIDEO_NOT_FOUND
  await load(`<!DOCTYPE html><html><head><title>#ootd穿搭 #扭一扭 - 抖音</title></head><body>
    <h1>#ootd穿搭 #扭一扭</h1>
    <video src="blob:https://www.douyin.com/x"></video>
    <img alt="慕禾百货店" src="avatar">
  </body></html>`);
  const douyinSrc3 = getExtractorSource("douyin");
  results.douyin_fixture_unhydrated = await page.evaluate(`(${douyinSrc3})()`);
  check("douyin: unhydrated page not VIDEO_NOT_FOUND", !results.douyin_fixture_unhydrated.error, JSON.stringify(results.douyin_fixture_unhydrated.error));

  // Douyin: empty title + no anchors -> VIDEO_NOT_FOUND (no empty-shell leak)
  await load(`<!DOCTYPE html><html><head><title></title></head><body><div class="placeholder"></div></body></html>`);
  results.douyin_fixture_empty_shell = await page.evaluate(`(${douyinSrc3})()`);
  check("douyin: empty title + no anchors -> VIDEO_NOT_FOUND", results.douyin_fixture_empty_shell.error === "VIDEO_NOT_FOUND", JSON.stringify(results.douyin_fixture_empty_shell));

  // Toutiao: no article container at all -> NO_CONTENT (and must not throw)
  await load(`<!DOCTYPE html><html><head><title>出错啦 - 今日头条</title></head><body><p>内容不存在</p></body></html>`);
  const toutiaoSrc3 = getExtractorSource("toutiao");
  results.toutiao_fixture_no_content = await page.evaluate(`(${toutiaoSrc3})()`);
  check("toutiao: no article container -> NO_CONTENT", results.toutiao_fixture_no_content.error === "NO_CONTENT", JSON.stringify(results.toutiao_fixture_no_content));

  // WeChat: deleted content -> DELETED
  await load(`<!DOCTYPE html><html><head><title>微信公众平台</title></head><body><p>该内容已被发布者删除</p></body></html>`);
  const wechatSrc3 = getExtractorSource("wechat");
  results.wechat_fixture_deleted = await page.evaluate(`(${wechatSrc3})()`);
  check("wechat: deleted content -> DELETED", results.wechat_fixture_deleted.error === "DELETED", JSON.stringify(results.wechat_fixture_deleted));

  // Generic: totally empty page -> EMPTY
  await load(`<!DOCTYPE html><html><head><title></title></head><body></body></html>`);
  const genericSrc3 = getExtractorSource("generic");
  results.generic_fixture_empty = await page.evaluate(`(${genericSrc3})()`);
  check("generic: empty page -> EMPTY", results.generic_fixture_empty.error === "EMPTY", JSON.stringify(results.generic_fixture_empty));

  await browser.close();

  writeFileSync(path.join(OUT_DIR, "fixtures.json"), JSON.stringify(results, null, 2));
  if (failures.length) {
    console.log(`\n${failures.length} assertion(s) FAILED`);
    process.exit(1);
  }
  console.log("\nAll fixture assertions passed");
}

main().catch(e => { console.error(e); process.exit(1); });
