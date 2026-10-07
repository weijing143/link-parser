# 回归测试链接清单

平台改版是提取器失效的头号原因。每次修改任何提取器后，用本清单里的链接快速跑一遍，确认没有改坏其他平台。

## 使用方法

1. 逐条把链接发给 agent，触发 link-parser 解析
2. 对照"预期字段"列检查返回的卡片：核心字段（标题/作者/正文）必须非空，标注 *(可选)* 的字段允许缺失
3. 某条链接失效（视频删除、文章 404）时，换一条同类型的新链接并更新本文件
4. **占位符 `（待填）` 需要你用实际解析成功过的链接替换**——优先选内容稳定、不会删除的（官方账号、经典老视频）

## 视频平台

| 平台 | 链接 | 预期字段 | 上次验证 |
|---|---|---|---|
| B站视频 | （待填，例：`bilibili.com/video/BV…`） | title、author、publishTime、duration、stats、cover、tags | — |
| B站分P视频 | （待填） | parts 数组 ≥ 2 项 | — |
| 抖音视频 | （待填，可用 `v.douyin.com` 短链测跳转） | title、author、stats（点赞/评论/收藏/分享）、publishTime | — |
| 西瓜视频 | （待填） | title、author、cover、body | — |

## 文章平台

| 平台 | 链接 | 预期字段 | 上次验证 |
|---|---|---|---|
| 公众号文章 | （待填，`mp.weixin.qq.com/s/…`） | title、author（公众号名）、publishTime、body、images | — |
| 头条文章 | （待填） | title、publishTime、body（不含播放器噪声） | — |
| 知乎问答 | （待填，`/question/…/answer/…`） | title、author、stats（赞同/评论）、body（末尾无操作栏噪声） | — |
| 知乎专栏 | （待填，`zhuanlan.zhihu.com/p/…`） | title、author、cover、images | — |
| 通用网页 | （待填，任意外文博客/新闻页） | title（OG）、description、cover | — |

## 边界场景（可选）

| 场景 | 链接 | 预期行为 |
|---|---|---|
| B站带分享参数 | 任意 `?share_source=…` 链接 | 自动清洗为干净 BV URL，不发生自动连播串数据 |
| 过期/删除内容 | （待填） | 返回 ErrorResult，走 generic 兜底并诚实告知 |
| 登录墙 | （待填） | 停止并提示用户先登录，不尝试绕过 |

## 验证记录

| 日期 | 修改内容 | 结果 | 备注 |
|---|---|---|---|
| 2026-10-07 | 首次建立清单（文档/健壮性优化批次） | 待首次验证 | 链接待补充 |
