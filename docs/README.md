# 在线 FFmpeg 工具箱

一个**完全在浏览器本地运行**的音视频 / 图片处理工具。基于 [FFmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm)，提供 23 项常用处理功能，文件**不会上传到任何服务器**。

---

## 功能概览

| 分类 | 功能 |
| --- | --- |
| 🎬 视频处理（11） | 格式转换、视频压缩、分辨率调整、旋转/翻转、剪切、变速、转 GIF、去除音轨、视频截图、图片转视频、音视频合并 |
| 🎵 音频处理（2） | 音频格式转换（也可从视频提取音轨）、剪切 / 音量 / 淡入淡出 |
| 🖼️ 图片处理（10） | 格式转换、压缩与缩放（支持批量）、证件照制作（换底 + 标准尺寸）、图片裁剪、水印（文字 / 图片，支持中文、平铺、批量）、图片拼接、滤镜风格、添加边框、去除元数据、旋转 / 翻转 / 调色 |

主要特点：

- **隐私安全**：所有计算在本地浏览器中完成，文件不离开用户设备。
- **开箱即用**：FFmpeg 核心已内置在页面中，不依赖任何 CDN，离线 / 内网环境可用。
- **单文件发布**：构建产物只有一个 `dist/index.html`，可直接部署到任意静态托管服务。
- **链式处理**：处理结果可一键"作为输入继续处理"。

---

## 快速开始

### 环境要求

- Node.js 20.19 及以上，或 22.12 及以上（Vite 7 的要求）
- 现代浏览器：Chrome / Edge / Firefox / Safari 最新版本

### 本地开发

```bash
npm install
npm run dev
```

浏览器访问 Vite 输出的本地地址（通常是 `http://localhost:5173`）。

### 生产构建

```bash
npm run build
```

构建产物位于 `dist/index.html`（约 43 MB，因为 FFmpeg WebAssembly 核心已内嵌其中）。

### 部署

将 `dist/index.html` 放到任意静态服务器即可，例如：

```bash
npx vite preview          # 本地预览
# 或直接上传 dist/index.html 到 Nginx / OSS / GitHub Pages 等
```

> 建议通过 `http://` 或 `https://` 访问，不建议直接双击 `file://` 打开，以避免浏览器对 Worker 的安全限制。

---

## 技术栈

| 类别 | 选型 |
| --- | --- |
| 框架 | React 19 + TypeScript |
| 构建 | Vite 7 |
| 样式 | Tailwind CSS 4 |
| 音视频引擎 | FFmpeg.wasm（`@ffmpeg/core` 0.12.6，单线程版；自研 Worker 调用，`@ffmpeg/util` 提供文件工具） |
| 发布 | `vite-plugin-singlefile`（单 HTML 文件） |

---

## 文档索引

| 文档 | 面向读者 | 内容 |
| --- | --- | --- |
| [README.md](./README.md) | 所有人 | 项目总览、快速开始 |
| [TECHNICAL.md](./TECHNICAL.md) | 开发者 / 运维 | 架构设计、模块说明、消息协议、扩展方法、故障排查 |
| [USER_MANUAL.md](./USER_MANUAL.md) | 最终用户 | 功能说明、操作步骤、参数详解、常见问题 |

---

## 常见问题速查

- **页面顶部显示"FFmpeg 加载失败"**：刷新页面并点击"重试"；确认使用的是最新版浏览器。详见 [技术文档 · 故障排查](./TECHNICAL.md#9-故障排查)。
- **长时间停在"正在初始化 WebAssembly"**：多为浏览器内存不足或设备性能较弱，可关闭其他标签页后刷新；超过 120 秒会自动报错。
- **处理很慢**：这是单线程 WebAssembly 的正常表现。建议先压缩分辨率、缩短时长，或处理更小的文件。

---

## 目录结构

```
.
├── docs/                    # 项目文档（本目录）
├── src/
│   ├── App.tsx              # 主界面与状态管理
│   ├── main.tsx             # 入口
│   ├── index.css            # Tailwind 样式入口
│   ├── lib/
│   │   ├── ffmpeg.ts        # FFmpeg 加载、任务调度、媒体信息解析
│   │   ├── ffmpeg.worker.ts # FFmpeg 运行的 Web Worker
│   │   ├── idphoto.ts       # 证件照抠图、换底、裁剪与编码（Canvas）
│   │   ├── textwatermark.ts # 文字水印图层渲染（Canvas → 透明 PNG）
│   │   └── tools.ts         # 23 个工具的定义与 FFmpeg 命令生成
│   ├── components/          # 侧边栏、文件选择、参数控件、结果面板
│   └── utils/format.ts      # 文件大小、时间等格式化工具
├── index.html               # 页面入口
├── vite.config.ts
└── package.json
```

---

## 注意事项

- 单个文件建议不超过 **500 MB**，浏览器内存有限，过大的文件可能导致处理失败。
- 高清视频转码耗时较长，处理期间请保持页面打开。
- 本工具的输出质量与速度取决于 FFmpeg 核心的编码器配置，部分格式的兼容性以实际测试为准。
