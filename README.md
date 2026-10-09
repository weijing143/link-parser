# link-parser

ZCode skill：解析主流中文平台链接，提取结构化内容。

## 支持平台

| 平台 | 提取内容 |
|---|---|
| **B站** | 标题、UP主、发布时间、播放/点赞/投币/收藏/弹幕、封面、标签、分P、简介 |
| **抖音** | 标题、作者、粉丝数、发布时间、点赞/评论/收藏/分享、AI 章节摘要、视频章节列表 |
| **公众号** | 标题、公众号名、原创作者、发布时间、封面、正文、图片列表 |
| **头条/西瓜** | 标题、作者、发布时间、封面、正文 |
| **知乎** | 问题标题、答主、发布时间、赞同/评论/收藏/喜欢、正文 |
| **通用网页** | OG meta（标题、描述、封面）+ 正文兜底 |

## 文件结构

```
link-parser/
├── SKILL.md              # 主流程：路由 + 输出格式 + 中止条件
├── test-harness/         # 自动化回归测试（Playwright，可选）
└── references/
    ├── bilibili.md       # B站视频/专栏提取器
    ├── douyin.md         # 抖音视频提取器
    ├── wechat.md         # 公众号文章提取器
    ├── toutiao.md        # 头条文章 + 西瓜视频提取器
    ├── zhihu.md          # 知乎问答/专栏/想法提取器
    ├── generic.md        # OG meta 兜底 + 已知限制
    ├── video-frames.md   # 视频逐秒截帧（可选，需显式触发）
    ├── video-record.md   # 视频录屏 MediaRecorder（可选，需显式触发）
    └── test-links.md     # 回归测试链接清单（平台改版后验证用）
```

## 回归测试

`test-harness/` 提供基于 Playwright 的提取器回归测试，修改任何提取器后建议跑一遍：

```bash
cd test-harness
npm install               # 首次；playwright@1.64
npx playwright install chromium   # 首次下载浏览器
node run-tests.mjs                    # 全部 6 平台实测（真实页面）
node run-tests.mjs douyin             # 单平台
node fixtures.mjs                     # 离线 fixture 断言（含 bug 回归保护）
```

说明：

- `run-tests.mjs` 用真实页面跑 `references/` 里的提取器，结果写到 `results/*.json`；B站/知乎等被 WAF 拦截时可换 `BROWSER=chrome` 用本机 Chrome 复跑。
- `fixtures.mjs` 不依赖外网，用构造 DOM 验证提取器逻辑（bilibili 字段映射 / 知乎统计清洗 / 抖音 stats 与 VIDEO_NOT_FOUND / 头条 author），任一条断言失败会以非零码退出。
- 抖音无稳定公开深链，`run-tests.mjs` 默认从首页推荐流发现链接，也可用 `DOUYIN_URL=https://www.douyin.com/video/xxx` 指定。
- 实测属于"解析单条公开页面"，请勿用于批量采集。

## 安装

将 `link-parser/` 目录放到 ZCode 的 skills 路径下：

- 项目级：`<project>/.agents/skills/link-parser/`
- 用户级：`~/.agents/skills/link-parser/`

## 使用

在 ZCode 对话中直接发送链接，skill 自动触发。或手动加载：

```
/skill link-parser <链接>
```

## 工作原理

在已登录的 Playwright 浏览器中打开链接，通过页面内 JavaScript 提取 DOM 中的结构化数据。各平台使用不同的提取策略（`__INITIAL_STATE__`、DOM ID、`innerText` 正则等）。

## 已知限制

- 纯客户端 SPA（无 SSR）无法通过 fetch 工具提取
- 多 `<body>` 嵌套结构（如 MSN）会触发 Playwright 严格模式限制
- 抖音/西瓜的视频流为 blob URL，无法直接下载

## 免责声明

本项目仅供个人学习与研究使用。使用者应仅解析自己有权访问的公开页面或本人登录会话中的内容，不得将提取的内容用于二次分发、批量采集、绕过付费墙或任何侵犯版权及平台用户协议的行为。各平台页面结构版权归平台所有，提取行为产生的法律责任由使用者自行承担。项目作者不对滥用导致的任何后果负责。

## License

[MIT](LICENSE) © weijing143
