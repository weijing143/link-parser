// Load extractor functions from the skill's reference files.
// Each reference file contains one or more ```js code fences holding an extractor function.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REF_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../references");

function codeBlocks(file) {
  const md = readFileSync(path.join(REF_DIR, file), "utf8");
  const re = /```js\n([\s\S]*?)```/g;
  const blocks = [];
  let m;
  while ((m = re.exec(md))) blocks.push(m[1].trim());
  return blocks;
}

// The extractor block is the one that returns `extractedAt`
// (wait-condition snippets come first in most reference files).
function extractorBlock(blocks) {
  return blocks.find(b => /extractedAt/.test(b)) || blocks[0];
}

function loadFn(src) {
  // eslint-disable-next-line no-new-func
  return new Function(`return (${src});`)();
}

export function getExtractor(platform, variant) {
  switch (platform) {
    case "bilibili": {
      const src = codeBlocks("bilibili.md").find(b => b.startsWith("(targetBvid)"));
      return loadFn(src);
    }
    case "douyin":
      return loadFn(extractorBlock(codeBlocks("douyin.md")));
    case "wechat":
      return loadFn(extractorBlock(codeBlocks("wechat.md")));
    case "toutiao":
      return loadFn(extractorBlock(codeBlocks("toutiao.md"))); // 文章提取器
    case "zhihu": {
      // 三个提取器：问答页 / 专栏文章 / 想法
      const fns = codeBlocks("zhihu.md").filter(b => /extractedAt/.test(b));
      const idx = { answer: 0, article: 1, pin: 2 }[variant || "answer"] ?? 0;
      return loadFn(fns[idx]);
    }
    case "generic":
      return loadFn(extractorBlock(codeBlocks("generic.md")));
    default:
      throw new Error("unknown platform " + platform);
  }
}

// Extractors as source strings, for Playwright page.evaluate(fn) serialization.
export function getExtractorSource(platform, variant) {
  const fn = getExtractor(platform, variant);
  return fn.toString();
}
