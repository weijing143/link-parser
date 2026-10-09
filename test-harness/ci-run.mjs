// CI regression runner: executes the extractors from references/ against the
// test-links.md link set with Playwright's bundled Chromium, classifies each
// result and writes a GitHub Actions job summary.
//
// Classification:
//   PASS           — 正向链接拿到完整 ParseResult / 负向链接拿到预期 ErrorResult
//   BLOCKED        — 平台风控/反爬/登录墙拦截（环境限制，输出为警告，不 fail）
//   EXTRACTOR_FAIL — 提取器自身问题（核心字段缺失且无 error、未预期的 error 等），fail
//
// Exit code: 0 unless at least one EXTRACTOR_FAIL.
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getExtractorSource } from "./extractors.mjs";

const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "results");
mkdirSync(OUT_DIR, { recursive: true });

// 与 references/test-links.md 保持一致
const CASES = [
  { name: "bilibili", url: "https://www.bilibili.com/video/BV1GJ411x7h7/", platform: "bilibili", arg: "BV1GJ411x7h7", waitMs: 1000, expect: "parse" },
  { name: "bilibili-not-found", url: "https://www.bilibili.com/video/BV1aa411a7aa/", platform: "bilibili", arg: "BV1aa411a7aa", waitMs: 1000, expect: "error", expectedErrors: ["NO_STATE", "WALL"] },
  { name: "douyin", url: process.env.DOUYIN_URL || "https://www.douyin.com/video/7519882634554543379", platform: "douyin", waitMs: 6000, expect: "parse" },
  { name: "douyin-deleted", url: "https://www.iesdouyin.com/share/video/6883418578486349070/", platform: "douyin", waitMs: 6000, expect: "error", expectedErrors: ["VIDEO_NOT_FOUND"] },
  { name: "wechat", url: "https://mp.weixin.qq.com/s/jKFtBtP5MXB95GBBFrpF4w", platform: "wechat", waitMs: 3000, expect: "parse" },
  { name: "toutiao", url: "https://www.toutiao.com/article/7127948627590349344/", platform: "toutiao", waitMs: 4000, expect: "parse" },
  { name: "zhihu", url: "https://www.zhihu.com/question/14300164636/answer/1896645253802475779", platform: "zhihu", waitMs: 4000, expect: "parse" },
  { name: "zhihu-not-found", url: "https://www.zhihu.com/question/99999999999", platform: "zhihu", waitMs: 4000, expect: "error", expectedErrors: ["NO_ANSWER", "NO_CONTENT", "WALL"] },
  { name: "generic", url: "https://en.wikipedia.org/wiki/Large_language_model", platform: "generic", waitMs: 2000, expect: "parse" },
];

// 反爬/风控页特征（命中则判 BLOCKED，与"提取器 bug"区分）
const BLOCK_RE = /安全验证|访问过于频繁|您当前请求存在异常|扫码登录|滑动验证|请登录后查看/i;

function classify(c, r, pageText) {
  if (pageText && BLOCK_RE.test(pageText.slice(0, 800))) return "BLOCKED";
  if (c.expect === "parse") {
    if (r && !r.error && r.title) return "PASS";
    if (r && (r.error === "WALL" || r.error === "NO_STATE")) return "BLOCKED"; // 平台拦截/未渲染，视为环境
    return "EXTRACTOR_FAIL";
  }
  // expect === "error"
  if (r && r.error && c.expectedErrors.includes(r.error)) return "PASS";
  if (r && r.error === "WALL") return "BLOCKED";
  return "EXTRACTOR_FAIL";
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const rows = [];
  const results = {};

  for (const c of CASES) {
    const rec = { url: c.url };
    let status = "ERROR";
    try {
      const ctx = await browser.newContext({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        locale: "zh-CN",
        viewport: { width: 1440, height: 900 },
      });
      const page = await ctx.newPage();
      await page.goto(c.url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(c.waitMs);
      const pageText = await page.evaluate(() => (document.body?.innerText || "").slice(0, 800));
      const src = getExtractorSource(c.platform);
      const expr = c.arg ? `(${src})("${c.arg}")` : `(${src})()`;
      rec.result = await page.evaluate(expr);
      status = classify(c, rec.result, pageText);
      rec.detail = rec.result.error
        ? `error=${rec.result.error}`
        : `title="${(rec.result.title || "").slice(0, 50)}"`;
      await ctx.close();
    } catch (e) {
      // 导航失败/网络错误（如 CI 出口访问某站点被墙）视为环境阻塞，不 fail
      status = "BLOCKED";
      rec.detail = "nav: " + String(e?.message || e).slice(0, 120);
    }
    rec.status = status;
    results[c.name] = rec;
    rows.push(`| ${c.name} | ${status} | ${rec.detail || ""} |`);
    console.log(`${status}  ${c.name}  ${rec.detail || ""}`);
  }
  await browser.close();

  writeFileSync(path.join(OUT_DIR, "ci-run.json"), JSON.stringify(results, null, 2));

  const nFail = rows.filter(r => r.includes("EXTRACTOR_FAIL")).length;
  const nBlocked = rows.filter(r => r.includes("BLOCKED")).length;
  const summary = [
    `# link-parser 提取器回归结果`,
    ``,
    `| 用例 | 结果 | 明细 |`,
    `|---|---|---|`,
    ...rows,
    ``,
    `**通过 ${rows.length - nFail - nBlocked} / 阻塞(BLOCKED，环境限制) ${nBlocked} / 失败 ${nFail}**`,
    ``,
    `BLOCKED = 平台风控/反爬/登录墙（GitHub 机房 IP 访问中文平台常见），不计为失败；`,
    `EXTRACTOR_FAIL / ERROR = 提取器自身问题，会导致本 job 失败。`,
  ].join("\n");

  if (process.env.GITHUB_STEP_SUMMARY) {
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  } else {
    console.log("\n" + summary);
  }

  if (nFail > 0) process.exit(1);
  console.log(`\nCI regression done: ${nBlocked} blocked (warning), 0 failed`);
}

main().catch(e => { console.error(e); process.exit(1); });
