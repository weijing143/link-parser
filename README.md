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
└── references/
    ├── bilibili.md       # B站视频/专栏提取器
    ├── douyin.md         # 抖音视频提取器
    ├── wechat.md         # 公众号文章提取器
    ├── toutiao.md        # 头条文章 + 西瓜视频提取器
    ├── zhihu.md          # 知乎问答/专栏/想法提取器
    └── generic.md        # OG meta 兜底 + 已知限制
```

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
