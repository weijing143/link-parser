// Real-browser verification for bilibili / zhihu extractors using the system
// Chrome via playwright-core (no bundled browser download) and a throwaway
// profile so it never touches the user's running Chrome.
//
//   node real-browser.mjs           # all 4 cases
//   node real-browser.mjs bilibili  # single platform
//
// Exit code: 0 = all assertions passed (BLOCKED counts as warning, not failure),
//            1 = at least one assertion failed.
import { chromium } from "playwright-core";
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getExtractorSource } from "./extractors.mjs";

const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "results");
mkdirSync(OUT_DIR, { recursive: true });

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// [name, url, extractor, arg, assert(result, page) -> {status, detail}]
const CASES = [
  {
    name: "bilibili-normal",
    url: "https://www.bilibili.com/video/BV1GJ411x7h7/",
    platform: "bilibili",
    arg: "BV1GJ411x7h7",
    waitMs: 1000, // bilibili.md: navigate 后最多等 1s 立即提取，防自动连播
    assert: (r) =>
      !r.error && r.title && r.author?.name
        ? { status: "PASS", detail: `title="${r.title.slice(0, 40)}" author=${r.author.name}` }
        : { status: "FAIL", detail: `expected full ParseResult, got error=${r.error} title=${JSON.stringify(r.title)}` },
  },
  {
    name: "bilibili-not-found",
    url: "https://www.bilibili.com/video/BV1aa411a7aa/",
    platform: "bilibili",
    arg: "BV1aa411a7aa",
    waitMs: 1000,
    assert: (r) =>
      r.error
        ? { status: "PASS", detail: `error=${r.error}` }
        : { status: "FAIL", detail: `expected ErrorResult, got title=${JSON.stringify(r.title)}` },
  },
  {
    name: "zhihu-normal",
    url: "https://www.zhihu.com/question/19550517/answer/122587039",
    platform: "zhihu",
    waitMs: 3000,
    assert: (r, page) => {
      if (page === "blocked") return { status: "BLOCKED", detail: "anti-bot wall (403/安全验证)" };
      return !r.error && r.title && r.body
        ? { status: "PASS", detail: `title="${r.title.slice(0, 40)}" body=${r.body.length}字` }
        : { status: "FAIL", detail: `expected full ParseResult, got error=${r.error} title=${JSON.stringify(r.title)}` };
    },
  },
  {
    name: "zhihu-not-found",
    url: "https://www.zhihu.com/question/99999999999",
    platform: "zhihu",
    waitMs: 3000,
    assert: (r, page) => {
      if (page === "blocked") return { status: "BLOCKED", detail: "anti-bot wall (403/安全验证)" };
      return r.error
        ? { status: "PASS", detail: `error=${r.error}` }
        : { status: "FAIL", detail: `expected ErrorResult, got title=${JSON.stringify(r.title)}` };
    },
  },
];

const BLOCK_RE = /安全验证|访问过于频繁|您当前请求存在异常|403|请先登录后查看|扫码登录/;

async function main() {
  const only = process.argv[2];
  const profileDir = mkdtempSync(path.join(os.tmpdir(), "link-parser-chrome-"));
  const results = {};
  const summary = [];

  let ctx;
  try {
    ctx = await chromium.launchPersistentContext(profileDir, {
      channel: "chrome",
      headless: process.env.HEADED ? false : true, // headless 被反爬拦时用 HEADED=1 试有头模式
      userAgent: UA,
      locale: "zh-CN",
      viewport: { width: 1440, height: 900 },
    });
    const page = ctx.pages()[0] || (await ctx.newPage());

    for (const c of CASES) {
      if (only && !c.name.startsWith(only)) continue;
      const rec = { url: c.url, startedAt: new Date().toISOString() };
      try {
        await page.goto(c.url, { waitUntil: "domcontentloaded", timeout: 45000 });
        await page.waitForTimeout(c.waitMs);
        rec.finalUrl = page.url();
        rec.pageTitle = await page.title();

        const headText = await page.evaluate(() => (document.body?.innerText || "").slice(0, 500));
        rec.blocked = BLOCK_RE.test(headText);

        const src = getExtractorSource(c.platform);
        const expr = c.arg ? `(${src})("${c.arg}")` : `(${src})()`;
        rec.result = await page.evaluate(expr);

        const verdict = c.assert(rec.result, rec.blocked ? "blocked" : "ok");
        rec.status = verdict.status;
        rec.detail = verdict.detail;
      } catch (e) {
        rec.status = "ERROR";
        rec.detail = String(e?.message || e);
      }
      results[c.name] = rec;
      summary.push(`${rec.status}  ${c.name}  ${rec.detail}`);
      console.log(`${rec.status}  ${c.name}  ${rec.detail}`);
    }
  } finally {
    if (ctx) await ctx.close().catch(() => {});
    rmSync(profileDir, { recursive: true, force: true });
  }

  writeFileSync(path.join(OUT_DIR, "real-browser.json"), JSON.stringify(results, null, 2));

  const failed = summary.filter(l => l.startsWith("FAIL") || l.startsWith("ERROR"));
  if (failed.length) {
    console.log(`\n${failed.length} case(s) FAILED`);
    process.exit(1);
  }
  const blocked = summary.filter(l => l.startsWith("BLOCKED"));
  console.log(`\nAll assertions passed${blocked.length ? ` (${blocked.length} BLOCKED as warning)` : ""}`);
}

main().catch(e => { console.error(e); process.exit(1); });
