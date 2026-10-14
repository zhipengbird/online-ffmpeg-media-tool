# 技术文档

本文档面向开发者与运维人员，描述"在线 FFmpeg 工具箱"的系统架构、模块职责、运行时协议、构建发布方式、故障排查与扩展方法。

- 产品功能与操作说明请参阅 [USER_MANUAL.md](./USER_MANUAL.md)
- 项目总览与快速开始请参阅 [README.md](./README.md)

---

## 目录

1. [系统概览](#1-系统概览)
2. [架构设计](#2-架构设计)
3. [目录与模块职责](#3-目录与模块职责)
4. [核心模块详解](#4-核心模块详解)
5. [关键业务流程](#5-关键业务流程)
6. [Worker 消息协议](#6-worker-消息协议)
7. [构建与发布](#7-构建与发布)
8. [性能与限制](#8-性能与限制)
9. [故障排查](#9-故障排查)
10. [扩展开发指南](#10-扩展开发指南)
11. [安全与兼容性](#11-安全与兼容性)

---

## 1. 系统概览

| 项目 | 说明 |
| --- | --- |
| 类型 | 纯前端单页应用（SPA），无后端服务 |
| 运行环境 | 现代浏览器（需支持 WebAssembly、Web Worker、Blob URL） |
| 音视频引擎 | FFmpeg 编译的 WebAssembly，单线程版（`@ffmpeg/core@0.12.6`，具体 FFmpeg 版本以该包为准） |
| 调用封装 | 自研 Worker（`lib/ffmpeg.worker.ts`）直接调用核心；`@ffmpeg/util` 提供 `fetchFile` 工具函数。`@ffmpeg/ffmpeg` 包目前未在代码中直接使用，仅作为其 Worker 协议的参考实现 |
| 前端框架 | React 19、TypeScript、Tailwind CSS 4 |
| 构建工具 | Vite 7，搭配 `vite-plugin-singlefile` 输出单 HTML |
| 数据存储 | 无持久化，所有状态保存在内存中，刷新即清空 |

---

## 2. 架构设计

### 2.1 分层结构

```
┌──────────────────────────────────────────────────────────────┐
│  表现层  components/*  Sidebar · FileDropZone · FieldControl │
│                        ResultPanel                           │
├──────────────────────────────────────────────────────────────┤
│  控制层  App.tsx   工具选择 · 参数状态 · 任务调度 · 结果管理    │
├──────────────────────────────────────────────────────────────┤
│  领域层  lib/tools.ts   23 个工具的定义、参数表单与命令生成      │
├──────────────────────────────────────────────────────────────┤
│  服务层  lib/ffmpeg.ts  核心加载 · 任务队列 · 媒体探测 · 文件读写 │
├──────────────────────────────────────────────────────────────┤
│  运行时  lib/ffmpeg.worker.ts （Web Worker，内含 FFmpeg WASM）  │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 运行时线程模型

```
主线程 (UI)                                 Worker 线程
───────────────────────────────────         ─────────────────────────────
React 渲染 / 用户交互                        FFmpeg WASM 核心
    │                                           ▲
    ▼                                           │
ffmpeg.ts  ── postMessage({id,type,data}) ──▶ ffmpeg.worker.ts
           ◀── postMessage({id,ok,data}) ───     │
           ◀── postMessage({type:"LOG"|"PROGRESS"}) ┘
```

设计要点：

- **FFmpeg 运行在独立 Worker 中**，长时间转码不会阻塞 UI 线程。
- **所有任务串行执行**（`enqueue` 队列），避免对同一 WASM 实例并发调用。
- **核心 JS 与 WASM 二进制直接内嵌**，Worker 通过 Blob URL 加载核心脚本，不发起任何网络请求。

### 2.3 状态流转

```
   ┌────────┐  选择文件   ┌────────────┐  点击开始  ┌─────────┐
   │ 待输入 │ ─────────▶ │ 已探测就绪 │ ────────▶ │ 处理中  │
   └────────┘            └────────────┘           └────┬────┘
        ▲                      ▲                      │
        │ 切换工具/移除         │ 作为输入继续          ├─ 成功 ─▶ 结果展示
        └──────────────────────┴──────────────────────┤
                                                      └─ 失败/取消 ─▶ 错误提示
```

---

## 3. 目录与模块职责

```
src/
├── App.tsx                  主界面：工具选择、参数 Map、任务状态、结果 URL 生命周期
├── main.tsx                 React 入口（StrictMode）
├── index.css                Tailwind 入口
├── vite-env.d.ts            Vite 类型声明（支持 ?raw / ?url / ?worker）
├── lib/
│   ├── ffmpeg.ts            FFmpeg 服务层：加载、队列、探测、运行、取消
│   ├── ffmpeg.worker.ts     Worker 脚本：加载核心、执行命令、文件读写
│   └── tools.ts             工具注册表：字段定义 + build() 命令生成
├── components/
│   ├── Sidebar.tsx          左侧分类导航
│   ├── FileDropZone.tsx     文件选择 / 拖拽 / 媒体信息标签
│   ├── FieldControl.tsx     参数控件（select / number / range / checkbox）
│   └── ResultPanel.tsx      输出预览、下载、链式处理
└── utils/
    ├── format.ts            formatBytes / formatTime / extOf / stem
    └── cn.ts                模板自带的 className 合并工具（当前未使用）
```

依赖方向：`components → App → lib/tools → (types) → lib/ffmpeg → worker`，UI 层不直接接触 WASM。

---

## 4. 核心模块详解

### 4.1 `lib/ffmpeg.worker.ts` —— Worker 运行时

Worker 支持以**ES 模块**或**经典脚本**方式运行（兼容 Vite 开发模式下的 Module Worker）。

加载流程 `LOAD`：

1. 将主线程传入的 `coreJs` 字符串通过 `Function` 动态执行（或降级为 Blob URL + `importScripts`），避免 Module Worker 不支持 `importScripts` 的问题。
2. 核心脚本执行后返回/挂载 `createFFmpegCore` 工厂函数。
3. 调用 `createFFmpegCore({ wasmBinary })`，直接传入 WASM 二进制，**不再通过 URL 拉取**。
4. 注册 `setLogger`（转发为 `LOG` 消息）与 `setProgress`（转发为 `PROGRESS` 消息）。

执行 `EXEC`：`ffmpeg.exec("-nostdin", ...args)`，执行后调用 `reset()` 清理内部状态，返回退出码。

文件系统：通过 `FS.writeFile / readFile / unlink` 操作 Emscripten 内存文件系统（MEMFS），所有输入输出都在内存中。

### 4.2 `lib/ffmpeg.ts` —— 服务层

对外暴露 4 个接口：

| 函数 | 作用 | 备注 |
| --- | --- | --- |
| `ensureFFmpeg(onStatus?)` | 加载核心，幂等 | 失败后可再次调用重试；120 秒超时 |
| `probeMedia(file, onStatus?)` | 读取时长、分辨率、音视频轨信息 | 执行 `ffmpeg -i`，解析 stderr 日志 |
| `runFFmpeg(params)` | 写入输入 → 执行参数 → 读取输出 | 自动清理虚拟文件系统中的临时文件 |
| `terminateFFmpeg()` | 取消并销毁 Worker | 所有等待中的请求以"任务已取消"失败 |

内部机制：

- **请求-响应映射**：`call()` 为每个请求分配自增 `id`，在 `pending` Map 中保存 resolve/reject，Worker 返回时按 `id` 匹配。
- **任务队列**：`enqueue()` 将 `probeMedia` / `runFFmpeg` 串行化，前一个任务完成后再执行下一个。
- **日志与进度**：`logSink` / `progressSink` 为当前任务的临时回调，任务结束后清空。
- **Worker 异常**：`onerror` / `onmessageerror` 触发 `dispose()`，销毁 Worker 并使所有挂起请求失败，下次调用会重新创建 Worker。

### 4.3 `lib/tools.ts` —— 工具注册表

每个工具是一个 `ToolDef` 对象：

```ts
interface ToolDef {
  id: string;            // 唯一标识，如 "video-compress"
  category: Category;    // "video" | "audio" | "image"
  name: string;          // 显示名称
  icon: string;          // 图标（emoji）
  desc: string;          // 简介
  accept: string[];      // 每个输入槽位的 accept 过滤器，长度即输入文件数
  inputLabels: string[]; // 每个输入槽位的标签
  fields: Field[];       // 参数表单定义
  build: (ctx) => { args, ext, mime };  // 生成 ffmpeg 参数
}
```

`Field` 支持六种控件：`select`（下拉）、`number`（数字）、`range`（滑块）、`checkbox`（开关）、`chips`（按钮组，如宽高比）、`presets`（预设卡片，自动附带"自定义"选项）。可通过 `visibleWhen(values)` 实现条件显示（例如只有选择 MP3/M4A 时才显示码率）。

**预设机制**：`presets` 类型字段的每个预设包含一组 `values`。选中预设时，`changeValue()` 一次性写入这些参数；修改任一参数后，`syncPresets()` 会自动把预设字段设为与当前参数匹配的预设，否则设为 `"custom"`。`getDefaults()` 默认套用第一个预设（或 `default` 指定的预设）的参数。

**批量处理**：`ToolDef.multiple = true` 时，输入区切换为 `BatchDropZone`，文件列表保存在 `App` 的 `batch: BatchItem[]` 状态中（`lib/batch.ts`），每项包含 `file / info / probing / status / progress / result / error`。处理流程 `handleBatchRun()`：

1. `resetBatchItems()` 清空旧结果并释放旧 Blob URL；
2. 按顺序对每项调用 `tool.build({ values, inputs: [name], infos: [info] })`，因此 `build()` 无需感知批量，仍只处理单文件；
3. 每项独立 `runFFmpeg()`，成功写入 `result`（Blob URL），失败写入 `error` 并继续下一项；
4. 通过 `runIdRef` 判断任务是否被取消，取消时正在处理的项标记为 `cancelled`；
5. `BatchResults` 展示逐项状态与总体进度，`downloadAll()` 通过 `fetch(blobURL)` 取回数据，使用 `utils/download.ts` 的 `zipFiles()`（JSZip）打包并 `downloadBlob()` 下载。

添加或移除文件会清空已有结果（避免结果与输入不对应）。新增支持批量的工具时，只需在 `ToolDef` 中设置 `multiple: true`。

**前置处理（preprocess）**：`ToolDef.preprocess?: (file, values) => Promise<File>` 允许在 FFmpeg 执行前用 Canvas 等浏览器能力处理输入。`App.tsx` 的单文件与批量两条执行路径都会先调用它，返回的 `File` 作为 FFmpeg 的真正输入，其扩展名决定 `inputN.ext` 的格式。证件照即采用此机制。

**证件照流水线（`lib/idphoto.ts`）**：

1. `createImageBitmap` 解码，缩放到最长边 ≤ 1200px，先铺白底（使透明区域也被视为背景）；
2. `findBackground()`：取顶边与左右上半部边缘像素的中位数作为背景色，从这些边缘出发做 BFS 泛洪（4 邻域，容差 42 的 RGB 欧氏距离），得到背景掩码。**刻意不从底边出发**，避免把底部衣服误判为背景；
3. 掩码区域替换为目标底色；
4. 按规格宽高比（mm 比例）取最大居中裁剪框，再按 `zoom`（≥1）缩小裁剪框、按 `offsetY` 平移（正数使人物更靠下），裁剪结果绘制到 `mmToPx(mm) = round(mm / 25.4 × 300)` 的像素尺寸；
5. JPG 且设置了大小上限时，在 0.3 ～ 0.95 之间二分搜索 `canvas.toBlob` 质量，取满足上限的最高质量；无法满足时抛出中文错误；
6. FFmpeg 端 `id-photo` 的 `build()` 仅做无损封装（`-c:v copy`），避免二次有损编码。

该方案无需额外模型，离线可用，但**只适合单一背景**。若需要复杂背景或白衣场景的高质量抠图，应引入人像分割模型（如 MediaPipe Selfie Segmentation 或 IMG.LY 背景移除），并将模型文件随应用内嵌，以保持无外部依赖。

**新增图片工具的约定**：`image-crop`、`image-filter`、`image-border`、`image-strip-meta` 等单输入工具设置 `multiple: true` 即可支持批量；`image-watermark` 是水印统一工具：`inputCount` 按水印类型决定输入数（文字模式 1 张、图片模式 2 张），批量时第二张图作为所有图片共享的 Logo，支持批量；`image-merge` 使用双输入 `filter_complex`，不支持批量。`inputCount` 与 `optionsFor`（选项随参数变化，如图片模式不提供平铺）由 `App.tsx` 和 `normalizeOptions()` 统一处理。图片编码统一由 `encodeArgs(format, quality)` 生成，`imageOutput()` 在其基础上加入 `-i` 与 `-vf`。

**叠加图层（overlay）**：`ToolDef.overlay?: (main, values) => Promise<File>` 用于需要由 Canvas 生成辅助图层的工具。`prepareInputs(tool, files, values)`（`lib/tools.ts`）统一完成输入准备：每个文件先经 `preprocess`，再追加 `overlay` 生成的图层，因此 `build()` 总是按 `[主图, 图层]` 的顺序接收输入。单文件与批量两条执行路径都调用它，行为一致。

水印工具的文字模式即采用此机制（`lib/textwatermark.ts`）：

- Canvas 绘制带透明通道的 PNG，使用系统字体栈（PingFang SC、Microsoft YaHei、Noto Sans CJK SC 等），支持多行、旋转、阴影、透明度与加粗；
- 字号以图片宽度百分比计算，因此批量时各图自动适配；
- 普通位置时图层为文字外接框，FFmpeg 使用 `overlay=<位置>` 叠加；平铺时图层与主图等大，以斜向网格重复绘制，FFmpeg 使用 `overlay=0:0`；
- **不把 CJK 字体打包进应用**，以控制体积。代价是中文显示依赖用户设备安装的字体，缺少中文字体时会显示为方框，这一点已在用户说明书中注明。

**输出说明**：`ToolDef.outputHint(values, infos)` 可返回面向用户的说明文字（例如图片压缩的预估输出尺寸），由 `App.tsx` 显示在参数区下方。图片尺寸规划由 `planResize(values, info)` 统一负责，同时生成 `-vf` 滤镜和说明文字，避免两处逻辑不一致。

`build()` 的输入：

- `values`：当前参数值
- `inputs`：虚拟文件名数组（`input0.mp4`、`input1.mp3` ...）
- `infos`：每个输入的 `MediaInfo`（时长、是否有音轨等），用于动态决策，例如"视频变速"在无音轨时跳过 `atempo` 滤镜

`build()` 只返回不含输出文件名的参数，输出文件名由 `App.tsx` 统一追加为 `output.{ext}`。

辅助函数：

- `atempoChain(speed)`：将任意速度拆分为 `atempo` 链（单个 `atempo` 仅支持 0.5～2.0）。
- `videoContainer / audioEncoder / imageOutput`：根据目标格式返回对应的编码器参数，供多个工具复用。
- `EVEN` 滤镜：`scale=trunc(iw/2)*2:trunc(ih/2)*2`，保证 yuv420p 编码所需的偶数宽高。

### 4.4 `App.tsx` —— 控制层

关键状态：

| 状态 | 类型 | 说明 |
| --- | --- | --- |
| `toolId` | `string` | 当前工具 |
| `slots` | `Slot[]` | 每个输入槽位的 `{file, info, probing}` |
| `valuesMap` | `Record<toolId, Values>` | 每个工具的参数独立保存，切换工具不丢失 |
| `running / progress` | `boolean / number` | 任务状态与进度 |
| `result` | `ResultData \| null` | 输出结果（含 Blob URL） |
| `coreMsg / coreError` | `string` | 核心加载状态与错误信息 |
| `runIdRef` | `number` (ref) | 任务代号，用于忽略已取消任务的回调 |

要点：

- **取消机制**：`handleCancel` 先递增 `runIdRef`，使旧任务的回调全部失效，再调用 `terminateFFmpeg()`。
- **Blob URL 释放**：`useEffect` 在 `result` 变化时释放旧 URL，避免内存泄漏。
- **日志节流**：日志先写入 `logBufRef`，每 400 ms 批量刷新到 React 状态，防止高频日志导致界面卡顿。
- **启动预加载**：挂载时调用 `ensureFFmpeg`，失败时在顶部显示错误并提供"重试"。

### 4.5 组件

- `FileDropZone`：支持点击选择与拖拽；选择文件后自动调用 `probeMedia`，展示时长、分辨率、音视频轨标签。
- `FieldControl`：根据 `Field.type` 渲染对应控件，纯展示组件，无副作用。
- `ResultPanel`：根据输出 MIME 类型选择 `<video>` / `<audio>` / `<img>` 预览，并计算体积变化比例。"作为输入继续处理"区域列出 `chainTargets`（单输入且 `accept` 与输出文件匹配的工具），点击后 `useResultAs(toolId)` 切换工具并载入文件。

**类型校验**：`utils/accept.ts` 的 `matchesAccept(accept, file)` 按 `<input accept>` 的语法（扩展名 `.mp4`、MIME 前缀 `video/*`、完整 MIME）判断文件是否合法。`handleFile()` 与 `addBatchFiles()` 在载入前校验，拖拽文件同样生效（拖拽不受 `<input accept>` 限制）。

**历史缺陷（已修复）**：早期"作为输入继续处理"总是把结果塞入当前工具。图片转视频输出 MP4 后再次作为输入，`-loop 1` 遇到视频输入会报 `Option loop not found`。现在 `chainTargets` 会过滤工具，且图片转视频的 `build()` 会校验输入扩展名，非图片直接抛出中文错误。
- `Sidebar`：按分类渲染工具列表，任务运行时禁用切换。

---

## 5. 关键业务流程

### 5.1 启动与核心加载

```
App 挂载
  └─ ensureFFmpeg()
       ├─ spawnWorker()                    创建 Worker
       ├─ fetch(wasmUrl) → ArrayBuffer     读取内嵌的 WASM（data URL）
       ├─ Promise.race([LOAD, 120s 超时])
       │     ├─ 成功 → ready = true，顶部显示"FFmpeg 已就绪"
       │     └─ 失败 → dispose()，显示错误与"重试"
```

### 5.2 选择文件（媒体探测）

```
用户选择文件 → handleFile(index, file)
  └─ probeMedia(file)
       ├─ WRITE_FILE  probe_input
       ├─ EXEC  -hide_banner -i probe_input     (退出码非 0 属正常，只为获取日志)
       ├─ 解析日志：Duration / Stream Video / Stream Audio / 分辨率
       └─ DELETE_FILE probe_input
```

### 5.3 执行处理

```
点击"开始处理" → handleRun()
  ├─ tool.build({ values, inputs, infos })   生成参数
  ├─ runFFmpeg({ inputs, args: [...args, "output.ext"] })
  │     ├─ WRITE_FILE  input0.ext, input1.ext ...
  │     ├─ EXEC  -hide_banner -y <args>       (退出码 != 0 → 抛出，附最后 12 行日志)
  │     ├─ READ_FILE  output.ext              (Uint8Array，零拷贝转移)
  │     └─ finally：DELETE 所有输入与输出临时文件
  └─ new Blob → URL.createObjectURL → 展示 ResultPanel
```

### 5.4 取消

```
点击"取消" → handleCancel()
  ├─ runIdRef++                      旧任务回调失效
  ├─ terminateFFmpeg()               Worker.terminate()，挂起请求全部 reject
  └─ retryCore()                     后台重新加载核心
```

---

## 6. Worker 消息协议

### 6.1 请求（主线程 → Worker）

```ts
{ id: number, type: string, data?: unknown }
```

| `type` | `data` | 返回 `data` | 说明 |
| --- | --- | --- | --- |
| `LOAD` | `{ coreJs: string, wasm: ArrayBuffer }` | — | 加载核心（`wasm` 为可转移对象） |
| `EXEC` | `{ args: string[], timeout?: number }` | `number`（退出码） | 执行 FFmpeg 命令 |
| `WRITE_FILE` | `{ path: string, data: Uint8Array }` | — | 写入虚拟文件系统 |
| `READ_FILE` | `{ path: string }` | `Uint8Array` | 读取输出（可转移） |
| `DELETE_FILE` | `{ path: string }` | — | 删除临时文件 |

### 6.2 响应（Worker → 主线程）

```ts
// 成功
{ id, ok: true, data }
// 失败
{ id, ok: false, error: string }
```

### 6.3 推送事件（Worker → 主线程，无 id）

```ts
{ type: "LOG", data: string }        // FFmpeg 日志行
{ type: "PROGRESS", data: number }   // 进度 0~1（由核心根据时间戳估算）
```

> 注意：`PROGRESS` 依赖输入文件的时长信息。对于 `-ss` 之后的部分操作或无法估算时长的输入，进度可能长时间为 0，此时 UI 会显示不确定进度条（脉冲动画）。

---

## 7. 构建与发布

### 7.1 构建流程

```bash
npm run build      # vite build → dist/index.html
```

`vite.config.ts` 中启用了 `viteSingleFile()`，它会：

- 把所有 JS / CSS 内联进 `index.html`；
- 将 `assetsInlineLimit` 设为始终内联，因此 WASM 也会以 `data:` URL 形式内嵌。

### 7.2 FFmpeg 资源的引入方式

| 资源 | 引入方式 | 说明 |
| --- | --- | --- |
| 核心 JS | `import coreJs from "...ffmpeg-core.js?raw"` | 作为字符串打包，运行时交给 Worker |
| 核心 WASM | `import wasmUrl from "...ffmpeg-core.wasm?url"` | 被单文件插件内联为 data URL，运行时 `fetch` 为 ArrayBuffer |
| Worker | `import FFmpegWorker from "./ffmpeg.worker.ts?worker&inline"` | 内联为 Blob Worker，不产生独立 `worker-*.js` 文件 |

这一设计使 `dist/index.html` 成为**唯一需要部署的文件**，且不依赖任何外部域名。

### 7.3 产物规模

- `dist/index.html` 约 **43 MB**（WASM 约 31 MB，base64 编码后膨胀约 33%）。
- 首次打开需要解析整个文件，通常需要数秒；之后由浏览器缓存。
- 若希望减小体积，可考虑：将 WASM 拆分为独立文件并通过 HTTP 缓存加载（需修改 `ffmpeg.ts` 中的 `?url` 为普通静态资源路径，并放弃单文件发布）。

### 7.4 部署注意：内容安全策略（CSP）

如果托管平台配置了 CSP，需要允许以下能力，否则会出现 **"加载失败"**（见第 9 节）：

```
Content-Security-Policy:
  script-src 'self' 'wasm-unsafe-eval' blob:;
  worker-src blob:;
```

- `'wasm-unsafe-eval'`：允许 WebAssembly 编译。
- `blob:`：允许加载 Blob 形式的 Worker 与核心脚本。

---

## 8. 性能与限制

| 项目 | 说明 |
| --- | --- |
| 线程模型 | 单线程 WASM，转码速度约为原生 FFmpeg 的 1/5～1/10，取决于设备 |
| 内存 | 输入、中间文件、输出均驻留在内存（MEMFS），单文件建议不超过 500 MB |
| 并发 | 所有任务串行执行，同一时间只能处理一个任务 |
| 超时 | 核心加载超时 120 秒；FFmpeg 执行无超时（由用户手动取消） |
| 多线程 | 未启用。启用需要 `SharedArrayBuffer`，即 COOP/COEP 响应头，目前为了兼容性不采用 |
| 输出下载 | 使用 Blob URL，关闭页面即失效 |
| 数据持久化 | 无；刷新页面后所有状态丢失 |

---

## 9. 故障排查

本节针对历史上出现的两类典型问题（**A：ffmpeg 加载不了**、**B：一直卡在初始化**）给出根因与排查方法。

### 9.1 问题 A：FFmpeg 加载不了

**旧版本症状**：页面可以打开，但无法使用任何功能。

**根因**：旧版本从 `unpkg.com` CDN 下载 FFmpeg 核心。在网络受限的环境（部分地区、公司内网、防火墙）中该域名不可达，`load()` 直接失败。

**当前版本**：核心已随应用一起打包，不再访问 CDN。若仍出现"FFmpeg 核心加载失败"，请按下列顺序排查：

| 错误信息关键字 | 可能原因 | 解决方法 |
| --- | --- | --- |
| `WebAssembly` 相关 / `CompileError` | 浏览器禁用了 WASM，或 CSP 缺少 `wasm-unsafe-eval` | 检查浏览器设置；补充 CSP（见 7.4） |
| `Worker` 相关 / `Refused to create a worker` | CSP 阻止 Blob Worker | 补充 `worker-src blob:` |
| `createFFmpegCore` 未找到 | 核心脚本未正确执行（通常是 CSP 阻止了 `blob:` 脚本） | 同上，补充 `script-src blob:` |
| `file://` 下出现 Worker 错误 | 部分浏览器对 `file://` 页面的 Worker 有限制 | 改用 `http://` 访问，例如 `npx vite preview` |

### 9.2 问题 B：一直卡在"正在初始化"

**旧版本症状**：页面显示"正在初始化 FFmpeg"，长时间没有反应，也没有错误提示。

**根因**：旧版本使用 `vite-plugin-singlefile` 构建，但 Worker 脚本仍被输出为独立的 `worker-*.js` 文件。只部署 `index.html` 时该文件缺失，Worker 启动失败；而旧版本没有超时机制，`load()` 永远等待。

**当前版本的改进**：

1. Worker 通过 `?worker&inline` 内联，不再依赖独立文件；
2. 加载增加 **120 秒超时**，超时后显示明确错误并可重试；
3. Worker 运行错误（`onerror`）会立即触发失败，而不是无限等待。

**如果当前版本仍然"卡住"**，通常是以下原因：

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 显示"正在下载 / 正在加载核心"很久 | 页面 43 MB 的 HTML 解析较慢，尤其在低端设备上 | 等待首次解析完成；之后浏览器会缓存 |
| 显示"正在初始化 WebAssembly"超过 30 秒 | 设备内存不足，WASM 编译失败前会长时间占用内存 | 关闭其他标签页、重启浏览器后再试 |
| 120 秒后报超时 | 浏览器性能不足或被扩展程序拦截 | 尝试无痕窗口（禁用扩展）或更换浏览器 |
| 没有任何状态文字变化 | JavaScript 执行被阻塞或页面未完整加载 | 打开开发者工具（F12）查看 Console 报错 |

### 9.3 开发者排查步骤

1. 打开浏览器开发者工具 → Console，搜索 `FFmpeg` 或 `Worker` 关键字。
2. 切换到 Network，确认没有对外部域名（如 `unpkg.com`）的请求。
3. 在 Console 中执行 `typeof WebAssembly`、`typeof Worker`，确认均为 `"object"` / `"function"`。
4. 若 `LOAD` 返回错误，错误信息会原样显示在页面顶部横幅中。
5. 本地运行 `npm run dev` 复现，并检查 Vite 控制台是否有构建警告。

### 9.4 处理失败（非加载问题）

任务执行失败时，页面会显示 FFmpeg 退出码及最后 12 行日志，可用于判断：

- `Invalid data found when processing input`：输入文件损坏或格式不受支持。
- `Unknown encoder 'xxx'`：当前 `@ffmpeg/core` 构建未包含该编码器，需更换格式或升级核心。
- `Option loop not found.`：`-loop` 是图片解复用器（image2）的选项，输入为视频等其他格式时会报错。图片转视频已在 `build()` 中校验输入必须为图片；若在其他地方出现，请检查是否把非图片文件送入了图片工具。
- `Output file #0 does not contain any stream`：通常有两种原因：
  1. **命令缺少 `-i` 输入**（历史缺陷）：旧版图片工具（图片压缩 / 格式转换 / 图片调整）的 `build()` 未包含 `-i <输入文件>`，FFmpeg 没有任何输入流。已通过 `imageOutput(input, ...)` 统一修复，所有图片工具的参数都以 `-i` 开头。新增工具时请务必检查参数中包含输入。
  2. **输入不包含所选操作需要的轨道**（例如对无音轨视频执行"提取音频"）。
- 排查方法：查看日志中 `Stream #0:0` 行，确认输入被正确识别；若日志中根本没有 `Input #0`，则是第 1 种情况。

---

## 10. 扩展开发指南

### 10.1 新增一个工具

只需修改 `src/lib/tools.ts`，无需改动 UI 代码：

```ts
{
  id: "audio-normalize",          // 唯一 id
  category: "audio",              // 出现在对应分类下
  name: "音频响度标准化",
  icon: "📢",
  desc: "使用 loudnorm 滤镜统一音量。",
  accept: [MEDIA_ACCEPT],
  inputLabels: ["音频 / 视频文件"],
  fields: [
    { key: "target", label: "目标响度", type: "range", default: -16, min: -30, max: -6, step: 1, unit: "LUFS" },
  ],
  build: ({ values, inputs }) => ({
    args: ["-i", inputs[0], "-vn", "-af", `loudnorm=I=${values.target}`, "-c:a", "libmp3lame", "-b:a", "192k"],
    ext: "mp3",
    mime: "audio/mpeg",
  }),
}
```

添加后会自动出现在侧边栏，并具备参数表单、进度、取消、预览与下载能力。

### 10.2 开发规范

- `build()` 只返回**不含输出文件名**的参数，输出名由框架统一追加。
- 输入文件通过 `inputs[i]` 引用，不要硬编码文件名。
- 需要根据输入信息决定参数时，使用 `infos[i]`，并在无法满足时抛出清晰的中文错误。
- 新增编码器前，先确认 `@ffmpeg/core` 的构建中包含该编码器。
- 使用 `visibleWhen` 隐藏与当前选项无关的参数。

### 10.3 升级 FFmpeg 核心

1. 修改 `package.json` 中的 `@ffmpeg/core` 版本（或通过 `install_npm_packages` 安装）。
2. 确认 `src/lib/ffmpeg.ts` 中的路径 `node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.{js,wasm}` 仍然有效。
3. 运行 `npm run build`，检查 `dist/index.html` 中不含外部 CDN 地址。
4. 回归测试所有 23 个工具。

---

## 11. 安全与兼容性

### 11.1 隐私

- 所有文件仅存在于浏览器内存中，不会被上传。
- 应用不包含任何统计、埋点或第三方脚本。
- 若需进一步保证，可在部署时启用 CSP 中的 `connect-src 'none'`，从网络层阻断外发请求。

### 11.2 浏览器兼容性

| 浏览器 | 最低建议版本 | 备注 |
| --- | --- | --- |
| Chrome / Edge | 最新两个大版本 | 推荐 |
| Firefox | 最新版本 | 支持 |
| Safari | 16.4 及以上 | 需 iOS / macOS 较新版本，大文件可能内存不足 |
| 移动端浏览器 | 视内存而定 | 不推荐处理大于 50 MB 的文件 |

### 11.3 编码器说明

功能是否可用取决于 `@ffmpeg/core@0.12.6` 的编译配置。以下格式依赖相应编码器，需在实际环境中验证：

- 视频编码：H.264（libx264）、VP8（libvpx）、MPEG-4
- 音频编码：MP3（libmp3lame）、AAC、Opus（libopus）、Vorbis（libvorbis）、FLAC、PCM
- 图片编码：PNG、JPEG（mjpeg）、WebP（libwebp）、BMP、GIF

若某个格式在特定浏览器或核心版本上报错 `Unknown encoder`，请参考 9.4 节处理。
