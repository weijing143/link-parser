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

  // Bilibili: matching BV
  await page.setContent(biliHtml, { waitUntil: "load" });
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
  await page.setContent(zhihuHtml, { waitUntil: "load" });
  const zhihuSrc = getExtractorSource("zhihu");
  results.zhihu_fixture = await page.evaluate(`(${zhihuSrc})()`);
  check("zhihu: title", results.zhihu_fixture.title === "如何评价测试驱动的开发？", results.zhihu_fixture.title);
  check("zhihu: stats", results.zhihu_fixture.stats?.upvotes === "1537" && results.zhihu_fixture.stats?.comments === "70", JSON.stringify(results.zhihu_fixture.stats));
  check("zhihu: body cleaned (no 赞同/分享 tail)", !/赞同|条评论|分享/.test(results.zhihu_fixture.body || ""), results.zhihu_fixture.body);

  // Douyin: valid video -> stats from info region only, footer numbers excluded
  await page.setContent(douyinValidHtml, { waitUntil: "load" });
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
  await page.setContent(douyinDeletedHtml, { waitUntil: "load" });
  results.douyin_fixture_deleted = await page.evaluate(`(${douyinSrc})()`);
  const dd = results.douyin_fixture_deleted;
  check("douyin: VIDEO_NOT_FOUND", dd.error === "VIDEO_NOT_FOUND", JSON.stringify(dd));
  check("douyin: ErrorResult has platform/url/extractedAt", dd.platform === "douyin" && !!dd.url && !!dd.extractedAt, JSON.stringify(dd));

  // Toutiao: author from a[href*='/user/'], not the "关注" button
  await page.setContent(toutiaoHtml, { waitUntil: "load" });
  const toutiaoSrc = getExtractorSource("toutiao");
  results.toutiao_fixture = await page.evaluate(`(${toutiaoSrc})()`);
  const tt = results.toutiao_fixture;
  check("toutiao: author from user link", tt.author?.name === "熊猫贝贝小可爱", JSON.stringify(tt.author));
  check("toutiao: author is not 关注", tt.author?.name !== "关注", JSON.stringify(tt.author));
  check("toutiao: publishTime", tt.publishTime === "2022-08-04 21:09", tt.publishTime);
  check("toutiao: body from article", /正文第一段/.test(tt.body || ""), tt.body);

  await browser.close();

  writeFileSync(path.join(OUT_DIR, "fixtures.json"), JSON.stringify(results, null, 2));
  if (failures.length) {
    console.log(`\n${failures.length} assertion(s) FAILED`);
    process.exit(1);
  }
  console.log("\nAll fixture assertions passed");
}

main().catch(e => { console.error(e); process.exit(1); });
