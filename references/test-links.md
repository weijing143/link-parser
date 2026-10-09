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
| B站视频 | `https://www.bilibili.com/video/BV1GJ411x7h7/`（经典老视频） | title、author、publishTime、duration、stats、cover、tags | 2026-10-09（真实 Chrome 实测通过：完整 ParseResult） |
| B站分P视频 | （待填） | parts 数组 ≥ 2 项 | — |
| 抖音视频 | `https://www.douyin.com/video/7519882634554543379`（2025-06 公开视频） | title、author、stats（点赞/评论/收藏/分享）、publishTime | 2026-10-09 |
| 抖音已删除视频 | `https://www.iesdouyin.com/share/video/6883418578486349070/`（短链跳转后应返回 `error: "VIDEO_NOT_FOUND"`） | ErrorResult 形状 | 2026-10-09 |
| 西瓜视频 | （待填） | title、author、cover、body | — |

## 文章平台

| 平台 | 链接 | 预期字段 | 上次验证 |
|---|---|---|---|
| 公众号文章 | `https://mp.weixin.qq.com/s/jKFtBtP5MXB95GBBFrpF4w` | title、author（公众号名）、publishTime、body、images | 2026-10-09 |
| 头条文章 | `https://www.toutiao.com/article/7127948627590349344/`（创作者小助手官方账号） | title、author（作者名，非"关注"按钮）、publishTime、body（不含播放器噪声） | 2026-10-09 |
| 知乎问答 | `https://www.zhihu.com/question/14300164636/answer/1896645253802475779` | title、author、stats（赞同/评论）、body（末尾无操作栏噪声） | 2026-10-09（本机被知乎反爬 403 拦截未实测——headless/headed 均如此，守卫由 fixture 覆盖；链接待可达网络复核） |
| 知乎专栏 | （待填） | title、author、cover、images | — |
| 通用网页 | `https://en.wikipedia.org/wiki/Large_language_model` | title（OG）、description、cover | 2026-10-09 |

## 边界场景（可选）

| 场景 | 链接 | 预期行为 |
|---|---|---|
| B站带分享参数 | 任意 `?share_source=…` 链接 | 自动清洗为干净 BV URL，不发生自动连播串数据 |
| B站不存在的 BV | `https://www.bilibili.com/video/BV1aa411a7aa/` | 返回 ErrorResult `error: "NO_STATE"`（2026-10-09 真实 Chrome 实测通过；注意 `BV1xx411c7mD`/`BV17x411w7KC` 都是真实存在的视频，不能当异常用例） |
| 过期/删除内容 | （待填） | 返回 ErrorResult，走 generic 兜底并诚实告知 |
| 登录墙 | （待填） | 停止并提示用户先登录，不尝试绕过 |

## 验证记录

| 日期 | 修改内容 | 结果 | 备注 |
|---|---|---|---|
| 2026-10-07 | 首次建立清单（文档/健壮性优化批次） | 待首次验证 | 链接待补充 |
| 2026-10-09 | 修复批次：抖音 stats 限定信息区取数 + VIDEO_NOT_FOUND 守卫、头条 author 优先取用户链接文本；回填全部实测链接；新增 test-harness 自动化回归 | 6 平台全部通过（B站/知乎本机 WAF/反爬拦截，fixture 离线验证通过） | 详见 TEST-REPORT.md 与 `test-harness/` |
| 2026-10-09 | 补测批次 2：bilibili/zhihu 提取器加错误守卫（WALL/NO_STATE/NO_ANSWER/NO_CONTENT）；playwright-core + 系统 Chrome 真实补测；新增 CI 定时回归 | B站正常/异常用例真实 Chrome 实测通过；知乎本机反爬 403 未实测（headless+headed 均拦），守卫由 fixture 覆盖；fixtures 30 断言全绿 | 更正批次 1 "B站 WAF 封 IP"结论（实为拦截非浏览器客户端）；详见 TEST-REPORT.md 补测批次 2 |
