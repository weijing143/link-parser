# link-parser 功能测试报告

- **测试日期**：2026-10-09
- **被测仓库**：`weijing143/link-parser`（本地副本 `link-parser`，与已安装版本 diff 无差异）
- **测试方法**：Node + 真实 Playwright（Chromium 156 headless / 本机 Chrome 153）加载真实页面，注入 `references/<platform>.md` 中的提取器函数并收集返回 JSON；对因反爬无法实测的平台（B站、知乎）用 Chromium fixture（`page.setContent` 构造代表性 DOM + `window.__INITIAL_STATE__`）验证提取器逻辑。
- **Harness**：`test-harness/run-tests.mjs`（实测）、`test-harness/fixtures.mjs`（离线 fixture）、`test-harness/probe-*.mjs`（诊断脚本），原始结果在 `test-harness/results/*.json`。
- **合规说明**：仅解析公开单条页面，未登录、未绕过任何验证码/登录墙。

## 总体结果

| 平台 | 判定 | 说明 |
|---|---|---|
| B站视频 | ⚠️ 部分通过 | 提取器逻辑 fixture 验证全部正确；本机 IP 被 B站 WAF 拦截无法实测 |
| 抖音视频 | ⚠️ 部分通过 | 作者/发布时间/AI摘要/章节正确；**stats 完全错误**；title 有污染；无错误检测 |
| 公众号文章 | ✅ 通过 | 全部核心字段正确 |
| 头条文章 | ⚠️ 基本通过 | title/publishTime/body/cover 正确；**author 提取错误**（"关注"按钮） |
| 知乎问答 | ⚠️ 部分通过 | 本机 IP 被知乎反爬 403；fixture 验证主流程正确，暴露 2 个健壮性问题 |
| 通用网页 | ✅ 通过 | OG title/cover/body/images 正确 |

核心字段通过率：实测的 4 个平台中 2 个完全通过；6 项中无"提取器抛错"，所有失败均为"静默返回错误或空数据"。

---

## 1. B站视频 — ⚠️ 部分通过（实测被 WAF 拦截，fixture 验证通过）

- **样本链接**：`https://www.bilibili.com/video/BV1GJ411x7h7/`（经典老视频；另测 `BV1xx411c7mD` 同结果）
- **实测结果**：页面返回 B站 WAF 错误页（`<title>出错啦! - bilibili.com`），`curl` 连 `api.bilibili.com/x/web-interface/view` 也返回 WAF HTML——**本机出口 IP 被 B站风控**，属环境限制而非提取器问题。真实页面上提取器返回了全空字段（`title:""`, `author:{}`, `stats:{}`），未抛错。
- **Fixture 验证**（`results/fixtures.json`）：
  - 匹配 BV：title/author(name+space url)/publishTime(ISO)/duration("12:34")/stats 七项/cover/tags/parts(2 个分P)/body/extra 全部正确映射 ✅
  - BV 不匹配：正确返回 `error: "AUTO_PLAY_SWITCHED"` + targetBvid/actualBvid，符合 SKILL.md ErrorResult 契约 ✅
- **发现的问题**：见问题 #4（vd.bvid 为空时不返回 ErrorResult，与文档承诺不符）。

## 2. 抖音视频 — ⚠️ 部分通过（stats 严重错误）

- **样本链接**：`https://www.douyin.com/video/7519882634554543379`（2025-06 公开视频，百度索引可证 4518 赞）；另用 `https://www.iesdouyin.com/share/video/6883418578486349070/` 验证短链跳转（该视频已删除）
- **提取结果（有效视频）**：
  - ✅ author：`慕禾百货店` + 主页 URL（img[alt] 策略生效）
  - ✅ publishTime：`2025-06-25 21:45`
  - ✅ body：AI 章节摘要正确提取（"两款粉色上衣分享…"）
  - ✅ chapters：`00:01 V领上衣 / 00:28 粉色上衣`；fansInfo：`{fans:"3053", totalLikes:"4536"}`
  - ❌ title：`https://www.douyin.com/video/7 #ootd穿搭 #扭一扭…` — 带 URL 垃圾前缀（问题 #5）
  - ❌ stats：`likes:"00570" comments:"11220230001" collects:"2026" shares:"0600005023"` — 实际是页脚许可证号（问题 #1）
- **已删除视频场景**：页面显示"你要观看的视频不存在"，提取器仍"成功"返回：title=站点默认标题、author=视频封面图 alt（整段视频标题+话题）、stats=页脚许可证号——**无任何 ErrorResult**（问题 #2）。
- **环境备注**：未登录状态下视频详情页可见；首页推荐流在 headless 下不渲染 `/video/` 链接（feed 需登录/交互），样本链接来自搜索引擎索引。

## 3. 公众号文章 — ✅ 通过

- **样本链接**：`https://mp.weixin.qq.com/s/jKFtBtP5MXB95GBBFrpF4w`（"云舒的AI实践笔记"，2025-03）
- **提取结果**：
  - ✅ title：`这段Prompt提示词，生成精美的文章总结卡，轻松搞定知识可视化`（#activity-name）
  - ✅ author：`云舒的AI实践笔记`（#js_name，公众号名，正确未与标题混淆）
  - ✅ publishTime：`2025年3月17日 09:00`；originalAuthor：`云舒掘金`
  - ✅ body：4000 字截断正常；cover：mmbiz qpic 图床 URL；images：10 张（data-src 懒加载处理生效）
  - ✅ stats 为空对象（前台无阅读数，符合预期）

## 4. 头条文章 — ⚠️ 基本通过（author 错误）

- **样本链接**：`https://www.toutiao.com/article/7127948627590349344/`（"创作者小助手"官方账号文章，2022-08）
- **提取结果**：
  - ✅ title：`首次"官宣"和居民端"主动缩表"：中国经济十字路口何去何从？`
  - ✅ publishTime：`2022-08-04 21:09`（innerText 正则命中）；body：纯正文段落（播放器噪声已跳过）；cover：og:image
  - ❌ author：`{name:"关注"}` — 实际作者应为"熊猫贝贝小可爱"（问题 #3）

## 5. 知乎问答 — ⚠️ 部分通过（实测被反爬 403，fixture 验证）

- **样本链接**：`https://www.zhihu.com/question/14300164636/answer/1896645253802475779`
- **实测结果**：知乎返回 40362 反爬 JSON（"您当前请求存在异常"），headless Chromium 与真实 Chrome 均如此——**环境/IP 被风控**，非提取器问题。空页面上提取器返回全空字段、无 ErrorResult（同问题 #4）。
- **Fixture 验证**（块级操作栏布局）：
  - ✅ questionTitle/title、author(name+url)、stats：`upvotes:"1537" comments:"70" favorites:"185" likes:"446"` 全部正确
  - ✅ 正文清洗：尾部"赞同/评论/收藏/分享"操作栏被正确剔除
  - ⚠️ body 开头混入作者名"测试答主"（问题 #6）
  - ⚠️ 行内布局 fixture（按钮无块级包裹）下：数字全部粘连（`upvotes:"153770"`），正文清洗失效——正则假设 `\n` 分隔，布局假设脆弱（问题 #6）

## 6. 通用网页 — ✅ 通过

- **样本链接**：`https://en.wikipedia.org/wiki/Large_language_model`
- **提取结果**：
  - ✅ title：`Large language model - Wikipedia`（og:title 优先）
  - ✅ cover：og:image 正确；body：正文容器克隆+去脚本样式后提取；images：20 张去重
  - ✅ siteName：`en.wikipedia.org`；type：`page`
  - ℹ️ description 为空：经 curl 验证该页面本身无 `og:description`/`description` meta，属页面限制而非 bug

---

## 发现的问题清单（按严重程度排序）

### #1 高 — 抖音 stats 提取失效，返回页脚许可证号
- **位置**：`references/douyin.md` 提取器"4. 统计数字"段（方案 A 正则 `(\d+)\s*\n...举报` 与方案 B "举报"前 100 字符取数，约 54–69 行）
- **现象**：当前抖音视频页面上方案 A 不匹配；方案 B 把页脚"（京）网药械网络信息服务备字（2023）第 00570 号 / 互联网新闻信息服务许可证 11220230001 / …"等备案号当成点赞/评论/收藏/分享返回。真实 4518 赞被报成 likes="00570"。**数据完全错误且无任何报错**，违反 SKILL.md "ErrorResult 一致错误形状"契约。
- **建议**：提取后做合理性校验（如点赞数应出现在含"点赞/赞"语义的容器附近，或直接校验数字量级/来源区域），失败时返回带 `partial` 的 ErrorResult。

### #2 高 — 抖音提取器无失败检测，"视频不存在"静默返回垃圾数据
- **位置**：`references/douyin.md` 提取器整体（无错误分支）
- **现象**：视频已删除时页面文案为"你要观看的视频不存在"，h1 缺失，但提取器仍返回 `title`=站点默认标题、`author.name`=封面图 alt（整段视频标题）、stats=页脚备案号。README/SKILL.md 声称失败会返回 ErrorResult，实际抖音提取器没有任何 ErrorResult 分支。
- **建议**：检测"你要观看的视频不存在"/h1 缺失/方案 A、B 均失败时返回 `{platform:"douyin", error:"VIDEO_NOT_FOUND" 或 "NO_STATE", partial}`。

### #3 中 — 头条 author 正则误捕"关注"按钮
- **位置**：`references/toutiao.md` 文章提取器 author 段（约 33–38 行）
- **现象**：`text.match(/(?:记者|作者|编辑)\s+(\S{1,6})/)` 在真实页面 innerText 中命中"作者\n\n关注"（"作者"标签 + 关注按钮），返回 `author.name="关注"`。诊断确认 `a[href*='/user/']` 的 textContent 即真实作者"熊猫贝贝小可爱"，但代码只取它的 href，从未用其文本兜底。
- **建议**：排除捕获值为"关注/粉丝/举报"等按钮词；增加 `a[href*='/user/']` 文本作为 author 兜底。

### #4 中 — bilibili/zhihu 提取器在状态缺失时不返回 ErrorResult（文档与代码不一致）
- **位置**：`references/bilibili.md` 注意点第 2 条（约 136 行）承诺"vd.bvid 为空返回 `{error:"no __INITIAL_STATE__.videoData"}`"，但代码块中的提取器函数没有该分支；`references/zhihu.md` 问答提取器同样无任何错误分支
- **现象**：B站 WAF 错误页/知乎 403 页面上，两者都返回 `title:""`、`author:{}` 的空壳 ParseResult，router 无法按 SKILL.md Step 5 的规则识别失败并走 generic 兜底，最终给用户一张空卡片。
- **建议**：在提取器入口加最小状态校验（核心字段为空 → ErrorResult + partial），或修改文档使承诺与实现一致。

### #5 低 — 抖音 title 带 URL 前缀
- **位置**：`references/douyin.md` 提取器"1. 标题"段
- **现象**：当前页面 h1 内含 SEO 链接文本，提取结果 title 为 `https://www.douyin.com/video/7 #ootd穿搭…`。建议在 title 上 `replace(/https?:\/\/\S+\s*/, "")`。

### #6 低 — 知乎 body 头部混入作者名；stats 正则依赖块级布局假设
- **位置**：`references/zhihu.md` 问答提取器（rawBody 取自 `.AnswerItem` 整个容器，cleanPattern 只清尾部；stats 正则假设 `\n` 分隔）
- **现象**：fixture 中 body 以"测试答主"开头（AuthorInfo 在 AnswerItem 内）；若操作栏为行内布局，innerText 无换行 → 赞同数与评论数粘连（`"153770"`）、正文清洗失效。真实页面当前布局下作者名前缀大概率也存在。
- **建议**：body 从 `.RichText` 子树取而非整个 `.AnswerItem`；stats 正则允许 `\s*` 已做但无法区分粘连数字，可考虑从 `initialData` 取数作为更稳的来源。

---

## 复现方式

```bash
cd link-parser/test-harness
npm install            # playwright@1.64.0（首次需 npx playwright install chromium）
node run-tests.mjs                    # 全部 6 平台实测
node run-tests.mjs douyin             # 单平台
DOUYIN_URL="https://www.douyin.com/video/7519882634554543379" node run-tests.mjs douyin
BROWSER=chrome node run-tests.mjs zhihu   # 用本机 Chrome 复跑
node fixtures.mjs                     # bilibili/zhihu 离线 fixture 验证
```

## 遗留说明

- B站、知乎的**真实页面**未能实测（WAF/反爬按 skill 规定未做绕过），其判定基于 fixture 逻辑验证 + 受控页面行为，置信度低于其他 4 个平台。
- `references/test-links.md` 的链接占位符 `（待填）` 本次可由本报告的样本链接回填（B站除外，需换一条未被 WAF 环境可达的链接验证）。
- 视频截帧/录屏（video-frames.md / video-record.md）不在本次测试范围。
