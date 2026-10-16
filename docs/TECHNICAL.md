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
| 构建工具 | Vite 7，代码分割与静态资源分块构建（`base: './'`） |
| 数据存储 | 无持久化，所有状态保存在内存中，刷新即清空 |

---

## 2. 架构设计

### 2.1 分层结构

```
┌──────────────────────────────────────────────────────────────┐
│  表现层  components/*  Sidebar · FileDropZone · FieldControl │
│                        BatchDropZone · BatchResults          │
│                        MergeStitchPanel · ResultPanel        │
├──────────────────────────────────────────────────────────────┤
│  控制层  App.tsx + hooks/useMediaRunner.ts                   │
│          工具选择 · 参数状态 · 单文件/批量队列调度 · 结果管理  │
├──────────────────────────────────────────────────────────────┤
│  领域层  lib/tools.ts   12 个场景化超级工具定义与管道构建     │
│          lib/idphoto.ts 证件照启发式抠图、换底与冲印排版     │
│          lib/textwatermark.ts Canvas 离线水印图层生成        │
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
├── App.tsx                  主界面：工作区布局、侧边栏、移动端抽屉、主题集成
├── main.tsx                 React 入口（StrictMode）
├── index.css                Tailwind 入口
├── vite-env.d.ts            Vite 类型声明（支持 ?raw / ?url / ?worker）
├── hooks/
│   └── useMediaRunner.ts    执行控制层：单文件/批量/多图拼接状态管理、文件探测、取消与执行调度
├── lib/
│   ├── ffmpeg.ts            FFmpeg 服务层：加载、队列、探测、运行、取消
│   ├── ffmpeg.worker.ts     Worker 脚本：加载核心、执行命令、文件读写
│   ├── idphoto.ts           证件照算法：启发式抠图、换底、300DPI 裁剪与多排版相纸冲印（Canvas）
│   ├── meme.ts              Meme Canvas 文字、描边与图片导出
│   ├── textwatermark.ts     水印图层算法：Canvas 离线渲染高质透明 PNG 水印
│   └── tools.ts             14 项场景化超级工具注册表：字段定义 + build() 命令管道生成
├── components/
│   ├── Sidebar.tsx          左侧工作站分类导航
│   ├── FileDropZone.tsx     单文件选择 / 拖拽 / 媒体信息标签
│   ├── BatchDropZone.tsx    批量多文件上传与管理列表
│   ├── BatchResults.tsx     批量处理结果队列（媒体感知缩略图、单项内联播放器、全屏模态预览）
│   ├── MergeStitchPanel.tsx 多图横纵拼接素材列表（拖拽加图、排序、删除、清空）
│   ├── FieldControl.tsx     参数控件（select / number / range / checkbox / chips / presets / color）
│   ├── MobileDrawer.tsx     移动端 Apple 风格底抽屉导航
│   ├── ThemeToggle.tsx      浅色 / 跟着系统 / 深色无闪烁切换按钮
│   └── ResultPanel.tsx      单文件输出预览、即时播放、下载、链式处理
└── utils/
    ├── format.ts            formatBytes / formatTime / extOf / stem 边界安全格式化
    └── theme.ts             三态主题系统与 localStorage 同步
```

依赖方向：`components → App / useMediaRunner → lib/tools → (types) → lib/ffmpeg → worker`，UI 层不直接接触 WASM。

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

**批量处理**：`ToolDef.multiple = true` 时，输入区切换为 `BatchDropZone`，支持多文件批量上传与队列化处理。当前已全面覆盖 `video-transcode`（多视频压制）、`audio-studio`（多音频转码剪辑）、`image-studio`（多图压缩与调色）、`image-meme`（多图 Canvas 文字合成）、`id-photo`（多照片换底排版）、`image-crop`（多图统一裁剪）与 `image-watermark`（多图共享 Logo/文字批量加水印）。处理流程由 `hooks/useMediaRunner.ts` 集中管理：

1. `resetBatchItems()` 清空旧结果并释放旧 Blob URL；
2. 按顺序对每项调用 `tool.build({ values, inputs: [name], infos: [info] })`，因此 `build()` 无需感知批量，仍专注单文件命令生成；
3. 每项独立 `runFFmpeg()`，成功写入 `result`（Blob URL），失败写入 `error` 并继续下一项；
4. 通过 `runIdRef` 判断任务是否被取消，取消时正在处理的项标记为 `cancelled`；
5. `BatchResults` 针对不同媒体类型呈现富交互：
   - **智能缩略图**：视频渲染首帧并叠加 `▶` 播放角标，音频展示唱片音符图标，图片展示真实画面；
   - **单任务极速内联播放器**：单项完成时直接在顶部展开交互式 `<video controls>` 播放器与体积对比，无需额外点击；
   - **全屏模态预览**：每项均提供「▶ 播放 / ▶ 试听 / 🔍 预览」按钮，点击弹出全屏大模态框，支持全屏播放、进度调节与键盘 ESC 快捷关闭；
   - **ZIP 打包导出**：`downloadAll()` 通过 `zipFiles()` 将批次文件无损归档为 ZIP 压缩包下载。

**多图横纵拼接流水线（`image-merge`）**：
- `ToolDef.mergeList: true`：输入区呈现 `MergeStitchPanel`，支持添加 2~30 张任意多格式图片；
- 用户可在面板中通过拖拽或「↑ 上移」「↓ 下移」按钮自由调整拼接次序，支持单张移除与一键清空；
- `build()` 接收动态 `inputs: string[]`，构建动态 FFmpeg `filter_complex` 管道：
  - 纵向长图：所有图片 `scale=size:-2` 统一宽度，通过 `vstack=inputs=N[out]` 上下无缝拼接；
  - 横向卷轴：所有图片 `scale=-2:size` 统一高度，通过 `hstack=inputs=N[out]` 左右对齐拼接。

**多图动态视频流水线（`video-img2vid`）**：
- `ToolDef.mergeList: true`：复用多图素材列表，允许 1~30 张图片按用户排序后作为多个 `-loop 1 -i` 输入；可选追加一条音频输入。
- 每张图片先统一画幅，再按 `motion` 选择 `zoompan` 推拉或动态 `crop` 平移；`style` 使用 `eq`、`hue`、`colorbalance`、`colorchannelmixer` 生成鲜艳、黑白、暖冷与复古效果。
- `transition` 为 `cut` 时使用 `concat`，其他转场使用连续 `xfade`；转场时长会从总时长中扣除，避免输出尾部多出空白画面。
- 输出固定为 H.264 + `yuv420p` MP4；背景音乐按所选 AAC 码率映射，并以 `-shortest` 结束于视频或音频较短者。

**图片 GIF 流水线（`image-gif`）**：
- 复用 `MergeStitchPanel` 管理 1~30 张图片和顺序；每张图片通过独立 `-loop 1 -i` 输入、`trim` 和 `concat` 生成连续帧。
- 合成后通过 `split -> palettegen -> paletteuse` 生成共享调色板，减少 GIF 色带与闪烁；输出支持无限循环或单次播放。

**Meme Canvas 流水线（`image-meme`）**：
- `components/MemeEditor.tsx` 在画布上维护底图、图片图层和文字图层，支持拖拽定位、图层选择、文字/颜色/描边/透明度/大小实时调整。
- 导出时隐藏编辑辅助框，只把最终合成画面转为 JPG/PNG `File`，再交给通用结果面板下载；整个编辑过程不上传图片。
- `lib/meme.ts` 保留为批量 Canvas Meme 渲染能力，供批量图片处理路径使用。

**前置处理（preprocess）**：`ToolDef.preprocess?: (file, values) => Promise<File>` 允许在 FFmpeg 执行前用 Canvas 等浏览器能力处理输入。单文件与批量两条执行路径都会先调用它，返回的 `File` 作为 FFmpeg 的真正输入。

**证件照流水线（`lib/idphoto.ts`）**：

1. `createImageBitmap` 解码，缩放到最长边 ≤ 1200px，先铺白底（使透明区域也被视为背景）；
2. `findBackground()`：取顶边与左右上半部边缘像素的中位数作为背景色，从这些边缘出发做 BFS 泛洪（4 邻域，容差 42 的 RGB 欧氏距离），得到背景掩码。**刻意不从底边出发**，避免把底部衣服误判为背景；
3. 掩码区域替换为白 / 蓝 / 红目标底色；
4. 按规格宽高比（mm 比例）取最大居中裁剪框，再按 `zoom`（≥1）缩小裁剪框、按 `offsetY` 垂直平移，裁剪结果绘制到 `mmToPx(mm) = round(mm / 25.4 × 300)` 像素尺寸；
5. **排版打印与冲印画布（`arrangeIdPhotoCanvas`）**：
   - `single`：保持单张 300DPI 标准规范照；
   - `2x2`（4 张）、`2x4`（8 张经典冲印）、`3x3`（9 宫格）：自动添加间距（2mm）与四周安全留白（4mm），排列于白色画布上；
   - `print6`（6 寸冲印相纸 1800×1200 像素 @ 300DPI）：算法自动计算横放与竖放的排版容量上限（如一寸满铺 10 张、二寸满铺 4 张），并居中对齐；
   - **裁切辅助虚线**：开启 `cutline` 时，在照片四周绘制浅灰辅助线（`#94a3b8`，8px 步长），方便手工精确剪裁；
6. 编码与体积控制：单张 JPG 且设置大小上限时，在 0.3 ～ 0.95 之间二分搜索 `canvas.toBlob` 质量；排版模式自动以 0.95 高清质量输出，文件名自动增加规格后缀（如 `photo_2x4.jpg`）。

**叠加图层（overlay）**：`ToolDef.overlay?: (main, values) => Promise<File>` 用于需要由 Canvas 生成辅助图层的工具。`prepareInputs(tool, files, values)` 统一完成输入准备：每个文件先经 `preprocess`，再追加 `overlay` 生成的图层。

水印工具（`lib/textwatermark.ts`）即采用此机制：
- 文字模式由 Canvas 离线绘制带透明通道的高清 PNG，字号基于主图宽度百分比自适应，支持字体加粗、透明度、旋转角、投影与平铺；
- 平铺模式下生成全图等大网格，FFmpeg 使用 `overlay=0:0`；指定角标位置时生成精准外接框，FFmpeg 使用边距公式精确定位；
- 图片 Logo 模式支持任意格式 Logo 图片，可调整缩放百分比（10%~50%）与边距，无偏移贴合。

### 4.4 `hooks/useMediaRunner.ts` —— 媒体执行控制层

将核心调度逻辑从页面组件中解耦：
- **状态管理**：集中管理 `slots`（单文件槽位）、`batch`（批量队列）、`mergeFiles`（多图拼接列表）、`running`、`progress` 与 `result`；
- **文件探测与输入校验**：调用 `probeMedia()` 提取音视频元数据，使用 `matchesAccept()` 进行多级 MIME 校验；
- **并发互斥与安全取消**：递增 `runIdRef` 使过期异步任务静默失效，通过 `terminateFFmpeg()` 中止 Worker 实例；
- **内存安全**：管理 Blob URL 生命周期，及时 `URL.revokeObjectURL()` 防止内存泄露。

### 4.5 表现层组件

- `Sidebar` & `MobileDrawer`：桌面端双栏工作站侧边栏与移动端 Apple 风格底部弹出抽屉；
- `FileDropZone` & `BatchDropZone`：单文件 / 批量拖拽上传与媒体信息状态展示；
- `MergeStitchPanel`：多图拼接素材管理面板，支持实时拖拽加图、上下排序与单张删除；
- `FieldControl`：动态参数渲染器，支持 `chips`（按钮组）、`presets`（常用预设卡片）、`select`、`range`、`checkbox` 等；
- `BatchResults`：多媒体批量结果呈现，支持媒体类型感知缩略图、单项即时播放器、全屏模态框预览与 ZIP 归档下载；
- `ResultPanel`：单文件多媒体内置播放器、画质与体积压缩率对比、下载与链式接力处理；
- `ThemeToggle`：无缝集成浅色、跟随系统、深色三态切换。

**类型校验**：`utils/accept.ts` 的 `matchesAccept(accept, file)` 按 `<input accept>` 的语法（扩展名 `.mp4`、MIME 前缀 `video/*`、完整 MIME）判断文件是否合法。`handleFile()` 与 `addBatchFiles()` 在载入前校验，拖拽文件同样生效（拖拽不受 `<input accept>` 限制）。

**历史缺陷（已修复）**：早期"作为输入继续处理"总是把结果塞入当前工具。图片动态封面视频输出 MP4 后再次作为输入，`-loop 1` 遇到视频输入会报 `Option loop not found`。现在 `chainTargets` 会过滤工具，且图片动态封面视频的 `build()` 会校验输入扩展名，非图片直接抛出中文错误。
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
npm run build      # vite build → dist/
```

配置采用现代分包架构与相对路径（`base: './'`）：
- 首屏 `index.html` 维持极轻量（约 0.85 KB），避免主线程阻塞与白屏；
- CSS / JS 独立分块，支持浏览器并发下载与 HTTP/2 流水线；
- 32MB WebAssembly 核心二进制作为独立资源按需异步流式加载，并享受浏览器持久强缓存。

### 7.2 FFmpeg 资源的引入方式

| 资源 | 引入方式 | 说明 |
| --- | --- | --- |
| 核心 JS | `import coreJs from "...ffmpeg-core.js?raw"` | 作为独立 chunk 或打包进主 JS，运行时传递给 Worker |
| 核心 WASM | `import wasmUrl from "...ffmpeg-core.wasm?url"` | 独立为 `assets/ffmpeg-core-*.wasm`，用户触发时异步 fetch |
| Worker | `import FFmpegWorker from "./ffmpeg.worker.ts?worker&inline"` | 内联为 Blob Worker，不产生独立 `worker-*.js` 文件，避免路径失效 |

### 7.3 产物规模与性能指标

| 指标 | 当前分包架构 | 历史单文件（已废弃） |
| --- | --- | --- |
| `index.html` 体积 | **0.85 KB** | 43.59 MB (Base64 WASM 内联) |
| 首屏传输 (Gzip) | **~178 KB** | ~14.3 MB |
| 首屏渲染 (FCP) | **< 300ms 毫秒级秒开** | 15 ~ 30 秒卡顿白屏 |
| WASM 加载模式 | 按需异步 fetch，享受 CDN / 浏览器 `immutable` 强缓存 | 首屏强行全量下载解析 |

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
- `Option loop not found.`：`-loop` 是图片解复用器（image2）的选项，输入为视频等其他格式时会报错。图片动态封面视频已在 `build()` 中校验输入必须为图片；若在其他地方出现，请检查是否把非图片文件送入了图片工具。
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
