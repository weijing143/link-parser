# Video Recording

可选功能：对 B站/抖音/西瓜视频进行 N 秒录屏，输出 webm 视频文件。

> ⚠️ **使用边界** — `captureStream()` + `MediaRecorder` 是浏览器原生 API，原理等同于系统录屏软件（OBS / QuickTime）或手机自带录屏功能：视频已在用户浏览器中正常加载播放，录制的是屏幕可见内容。此功能仅用于个人预览和内容审核目的（如快速浏览视频片段、存档自己有权访问的内容），**禁止**用于破解 DRM、规避平台保护措施、批量采集或二次分发他人版权内容。录制的 `.webm` 文件默认保存在本地，不会自动上传到任何外部服务。

## 触发条件

用户需**显式**要求录屏，关键词：`录屏` / `录像` / `录 N 秒` / `录视频` / `screen record`。未明确说时**不触发**。

## 适用平台

- B站视频（`bilibili.com/video/`）
- 抖音视频（`douyin.com/video/`）
- 西瓜视频（`ixigua.com/`）

前提：视频在浏览器中已缓冲就绪（`video.readyState >= 3`）。

## 原理

用浏览器原生 API 从 `<video>` 元素捕获媒体流并录制：

```
video.captureStream()           // 捕获视频的 MediaStream
  → new MediaRecorder(stream)   // 创建录制器
    → mediaRecorder.start()     // 开始录制
    → video.currentTime = 0     // 跳到开头
    → video.play()              // 播放
    → setTimeout N 秒后：       // 到时间后
      → video.pause()
      → mediaRecorder.stop()    // 停止录制
      → blob → 下载为 .webm     // 拿到文件
```

这种方式的优点是**不依赖外部工具**（无需 ffmpeg），直接在浏览器里完成录制，输出标准 webm 格式。

## 流程

```
0. 关闭弹幕          → B站: browser_click([aria-label="弹幕显示隐藏"])
                       或 el.style.display = 'none' on .bpx-player-dm
1. 确认视频就绪      → video.duration > 0 && video.readyState >= 3
2. 录制              → 见下方录制函数
3. 保存文件          → 触发浏览器下载，保存到 Playwright 工作目录
4. 卡片提示          → 在解析卡片底部标注录屏结果
```

## 录制函数

```js
async (page, duration = 5) => {
  // 返回 { file: string, size: number, duration: number }
  
  const result = await page.evaluate(async (dur) => {
    const video = document.querySelector('video');
    if (!video) return { error: '找不到video元素' };
    if (video.readyState < 3) return { error: '视频未缓冲就绪', readyState: video.readyState };

    const stream = video.captureStream();
    // VP9 编码的 webm，兼容性好
    const mediaRecorder = new MediaRecorder(stream, {
      mimeType: 'video/webm;codecs=vp9'
    });
    const chunks = [];

    return new Promise((resolve) => {
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `clip_${dur}s.webm`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        resolve({ done: true, size: blob.size, duration: dur });
      };

      // 开始录制
      mediaRecorder.start();
      video.currentTime = 0;
      video.play();

      // 到达指定时长后停止
      setTimeout(() => {
        video.pause();
        mediaRecorder.stop();
      }, dur * 1000);
    });
  }, duration);

  return result;
}
```

## 卡片展示

录屏完成后在解析卡片底部追加：

```markdown
### 🎬 视频录屏（5 秒）
已保存到 `clip_5s.webm` · 1.5 MB · webm/VP9 格式
```

## 注意点

- **关闭弹幕**：B站的弹幕层（`.bpx-player-dm`）会覆盖在视频上，录屏前**必须**先关闭。用 `browser_click([aria-label="弹幕显示隐藏"])` 或 `el.style.display = 'none'`。
- **无声录制**：`captureStream()` 默认不包含音频轨道。如需音频，加 `video.captureStream()` 前确保视频不静音。B站/抖音的 `<video>` 元素可能有独立的音频源，录屏时通常无音轨，这是正常现象。
- **编码格式**：`video/webm;codecs=vp9` 在 Chrome/Edge 中支持良好。如果报 `NotSupportedError`，降级为 `video/webm`（不指定 codec）。
- **分辨率**：录制分辨率和 `<video>` 元素的分辨率一致（B站通常 1080p）。画质取决于原始视频源，无法通过此方式提升。
- **文件位置**：文件通过浏览器下载到 Playwright 工作目录（`.playwright-mcp/` 或项目根目录），命名 `clip_5s.webm`。如果短时间内多次录屏，后一次会覆盖前一次。
- **与截帧的区别**：截帧适合静态预览（PNG 序列），录屏适合动态展示（单个 webm）。根据用户用词选择对应功能——说"截帧/截图/逐帧"走 video-frames.md，说"录屏/录像/录 N 秒"走本文件。
