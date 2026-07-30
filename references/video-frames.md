# Video Frame Capture

可选功能：解析 B站/抖音/西瓜等平台视频后，截取视频前 N 秒的帧画面作为预览图。

## 触发条件

用户需**显式**要求截帧，关键词：`截帧` / `截每一秒` / `视频预览` / `取帧` / `逐帧`。未明确说时**不触发**，避免每个视频都截 N 张图浪费资源。

## 适用平台

- B站视频（`bilibili.com/video/`）
- 抖音视频（`douyin.com/video/`）
- 西瓜视频（`ixigua.com/`）

前提：视频在浏览器中已缓冲就绪（`video.readyState >= 3`）。

## 流程

```
1. 确认视频就绪    → video.duration > 0 && video.readyState >= 3
2. 激活渲染管线    → video.play() 等 300ms → video.pause()
3. 循环截帧        → for t in 1..N:
                      video.currentTime = t
                      等 500ms（seek + 渲染）
                      截图 video 元素
4. 展示帧          → 内联在卡片中，或保存为文件
```

## 截帧函数

```js
async (page, frameCount = 5) => {
  const video = page.locator('video').first();

  // 1. 确认视频就绪
  const state = await video.evaluate(el => ({
    duration: el.duration,
    readyState: el.readyState,   // 3=HAVE_FUTURE_DATA, 4=HAVE_ENOUGH_DATA
    videoWidth: el.videoWidth,
    videoHeight: el.videoHeight,
  }));

  if (state.duration <= 0 || state.readyState < 3) {
    return { error: '视频未就绪', ...state };
  }

  // 2. 激活渲染管线（防止黑屏）
  await video.evaluate(el => el.play());
  await page.waitForTimeout(300);
  await video.evaluate(el => el.pause());

  const actualCount = Math.min(frameCount, Math.floor(state.duration));
  const frames = [];

  // 3. 逐秒截帧
  for (let t = 1; t <= actualCount; t++) {
    await video.evaluate((el, time) => { el.currentTime = time; }, t);
    await page.waitForTimeout(500);

    const filename = `frame_${String(t).padStart(2, '0')}s.png`;
    await video.screenshot({ path: filename, type: 'png' });
    frames.push({ time: t, file: filename });
  }

  return {
    videoSize: `${state.videoWidth}x${state.videoHeight}`,
    duration: state.duration,
    frameCount: frames.length,
    frames,
  };
}
```

## 注意点

- **渲染管线激活**：某些浏览器视频第一帧是黑屏，必须先 `play()` 再 `pause()` 激活解码器，否则截图全黑。
- **seek 精度**：`currentTime` 设置后需要等 400-600ms，给浏览器解码关键帧的时间。如果截图模糊或位置不对，说明等得不够久。
- **帧率**：B站/抖音的视频关键帧间隔通常 1-3 秒，`currentTime = N` 会跳到最近的关键帧，可能和预期时间偏差 0-2 秒。这是浏览器实现限制，无法避免。
- **blob URL**：B站/抖音的 `<video>.src` 是 blob URL，只能在当前浏览器会话里用。截图只能保存到本地文件，不能拿到 mp4 直链。
- **文件位置**：截图保存在 Playwright 的工作目录（通常是项目根目录），文件名 `frame_01s.png` ~ `frame_0Ns.png`。
- **卡片展示**：截帧后，在解析卡片末尾追加"视频预览帧"区域，最多展示 5 帧。超过 5 帧时标注"截取前 N 秒，共 N 帧，已保存到本地"。
