import { fetchFile } from "@ffmpeg/util";
import FFmpegWorker from "./ffmpeg.worker.ts?worker&inline";
// FFmpeg 单线程 WASM 核心直接打包进应用，不再依赖任何 CDN，离线/内网也可用
import coreJs from "../../node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.js?raw";
import wasmUrl from "../../node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm?url";

/**
 * FFmpeg.wasm 封装层
 * - FFmpeg 运行在独立 Worker 中，避免长时间转码阻塞页面
 * - 所有任务串行执行，避免并发调用导致错误
 */

export interface MediaInfo {
  duration: number; // 秒，未知为 0
  hasVideo: boolean;
  hasAudio: boolean;
  width: number;
  height: number;
}

type StatusCallback = (msg: string) => void;

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

const LOAD_TIMEOUT_MS = 120_000;

let worker: Worker | null = null;
let ready = false;
let loadPromise: Promise<void> | null = null;
let statusSink: StatusCallback | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();
let logSink: ((line: string) => void) | null = null;
let progressSink: ((p: number) => void) | null = null;
let queue: Promise<unknown> = Promise.resolve();

function failAll(err: Error) {
  const items = [...pending.values()];
  pending.clear();
  for (const p of items) p.reject(err);
}

/** 销毁当前 Worker，并让所有等待中的请求失败 */
function dispose(reason: Error) {
  const w = worker;
  worker = null;
  ready = false;
  loadPromise = null;
  w?.terminate();
  failAll(reason);
}

function spawnWorker(): Worker {
  const w = new FFmpegWorker();

  w.onmessage = (e: MessageEvent) => {
    const msg = e.data as {
      id?: number;
      type?: string;
      data?: unknown;
      ok?: boolean;
      error?: string;
    };
    if (msg.type === "LOG") {
      logSink?.(String(msg.data));
      return;
    }
    if (msg.type === "PROGRESS") {
      progressSink?.(Number(msg.data));
      return;
    }
    if (msg.id === undefined) return;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.ok) {
      p.resolve(msg.data);
    } else {
      const errStr = msg.error ?? "FFmpeg 执行出错";
      if (
        errStr.includes("memory access out of bounds") ||
        errStr.includes("abort") ||
        errStr.includes("Aborted")
      ) {
        dispose(new Error(errStr));
      }
      p.reject(new Error(errStr));
    }
  };

  w.onerror = (e: ErrorEvent) => {
    if (worker !== w) return;
    dispose(new Error(`FFmpeg Worker 运行出错${e.message ? `：${e.message}` : ""}`));
  };

  w.onmessageerror = () => {
    if (worker === w) dispose(new Error("FFmpeg Worker 消息解析失败"));
  };

  return w;
}

export function isFFmpegReady(): boolean {
  return ready;
}

function call<T = unknown>(type: string, data: unknown = {}, transfer: Transferable[] = []): Promise<T> {
  const w = worker;
  if (!w) return Promise.reject(new Error("FFmpeg 尚未就绪"));
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    w.postMessage({ id, type, data }, transfer);
  });
}

/** 加载 FFmpeg 核心（幂等，可重复调用；失败后可再次调用重试） */
export function ensureFFmpeg(onStatus?: StatusCallback): Promise<void> {
  if (onStatus) statusSink = onStatus;
  if (ready) return Promise.resolve();
  if (loadPromise) return loadPromise;

  const report = (msg: string) => statusSink?.(msg);
  let timer: number | undefined;

  loadPromise = (async () => {
    report("正在加载 FFmpeg 核心…");
    worker = spawnWorker();

    const wasm = await (await fetch(wasmUrl)).arrayBuffer();

    report("正在初始化 WebAssembly（首次约需数秒）…");
    const timeout = new Promise<never>((_, reject) => {
      timer = window.setTimeout(
        () => reject(new Error("初始化超时（120 秒），请刷新页面重试，或更换最新版 Chrome / Edge / Firefox")),
        LOAD_TIMEOUT_MS
      );
    });

    await Promise.race([call("LOAD", { coreJs, wasm }, [wasm]), timeout]);
    ready = true;
    report("");
  })()
    .catch((e: unknown) => {
      const err = e instanceof Error ? e : new Error(String(e));
      dispose(err);
      report("");
      throw err;
    })
    .finally(() => {
      window.clearTimeout(timer);
      loadPromise = null;
    });

  return loadPromise;
}

/** 强制终止当前 FFmpeg 任务（用于取消），之后需要重新 ensureFFmpeg */
export function terminateFFmpeg(): void {
  dispose(new Error("任务已取消"));
  logSink = null;
  progressSink = null;
  queue = Promise.resolve();
}

function parseProbe(logs: string[]): MediaInfo {
  const text = logs.join("\n");
  const dm = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const duration = dm ? Number(dm[1]) * 3600 + Number(dm[2]) * 60 + parseFloat(dm[3]) : 0;

  const videoLine = logs.find((l) => /Stream #\S+.*:\s*Video:/.test(l) && !/attached pic/.test(l));
  const audioLine = logs.find((l) => /Stream #\S+.*:\s*Audio:/.test(l));

  let width = 0;
  let height = 0;
  if (videoLine) {
    const rm = videoLine.match(/(\d{2,5})x(\d{2,5})/);
    if (rm) {
      width = Number(rm[1]);
      height = Number(rm[2]);
    }
  }

  return {
    duration,
    hasVideo: Boolean(videoLine),
    hasAudio: Boolean(audioLine),
    width,
    height,
  };
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = queue.then(task);
  queue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

async function writeInput(name: string, file: File): Promise<void> {
  const data = await fetchFile(file);
  await call("WRITE_FILE", { path: name, data }, [data.buffer as ArrayBuffer]);
}

function exec(args: string[]): Promise<number> {
  return call<number>("EXEC", { args, timeout: -1 });
}

async function removeFile(name: string): Promise<void> {
  await call("DELETE_FILE", { path: name }).catch(() => undefined);
}

/** 使用浏览器原生能力提取图片宽高，0 WASM 内存消耗，耗时仅数毫秒 */
async function probeImage(file: File): Promise<MediaInfo | null> {
  const isImage = file.type.startsWith("image/") || /\.(png|jpe?g|webp|bmp|gif|tiff?)$/i.test(file.name);
  if (!isImage) return null;

  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file);
      const info: MediaInfo = {
        duration: 0,
        hasVideo: true,
        hasAudio: false,
        width: bmp.width,
        height: bmp.height,
      };
      bmp.close();
      return info;
    } catch {
      // 降级为 Image 对象探测
    }
  }

  if (typeof Image !== "undefined") {
    return new Promise<MediaInfo | null>((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve({
          duration: 0,
          hasVideo: true,
          hasAudio: false,
          width: img.naturalWidth,
          height: img.naturalHeight,
        });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    });
  }

  return null;
}

/** 尝试使用 HTML5 原生 Video / Audio 标签快速读取时长与宽高，避免唤起 FFmpeg 占用内存 */
async function probeBrowserMedia(file: File): Promise<MediaInfo | null> {
  const isVideo = file.type.startsWith("video/") || /\.(mp4|webm|mov|m4v)$/i.test(file.name);
  const isAudio = file.type.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|aac)$/i.test(file.name);
  if (!isVideo && !isAudio) return null;

  if (typeof document === "undefined") return null;

  return new Promise<MediaInfo | null>((resolve) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement(isVideo ? "video" : "audio");
    el.preload = "metadata";
    let done = false;
    const finish = (info: MediaInfo | null) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      el.removeAttribute("src");
      el.load();
      URL.revokeObjectURL(url);
      resolve(info);
    };
    const timer = window.setTimeout(() => finish(null), 2500);

    el.onloadedmetadata = () => {
      const v = el as HTMLVideoElement;
      finish({
        duration: isFinite(el.duration) ? el.duration : 0,
        hasVideo: isVideo,
        hasAudio: isAudio || isVideo,
        width: isVideo ? v.videoWidth : 0,
        height: isVideo ? v.videoHeight : 0,
      });
    };
    el.onerror = () => {
      finish(null);
    };
    el.src = url;
  });
}

/** 读取媒体文件的基础信息（时长、是否有音视频轨、分辨率） */
export function probeMedia(file: File, onStatus?: StatusCallback): Promise<MediaInfo> {
  return enqueue(async () => {
    // 1. 优先尝试原生极速探测（图片与常见音视频），毫秒级完成且绝不污染 WASM
    const imgInfo = await probeImage(file);
    if (imgInfo) return imgInfo;

    const mediaInfo = await probeBrowserMedia(file);
    if (mediaInfo) return mediaInfo;

    // 2. 特殊格式（如 flv/mkv/avi 等）回退到 FFmpeg 探测
    await ensureFFmpeg(onStatus);
    const name = `probe_${Date.now()}`;
    const logs: string[] = [];
    logSink = (line) => logs.push(line);
    try {
      await writeInput(name, file);
      // 关键防崩：带上 -t 0.001 -f null - 确保 FFmpeg 正常退出（code 0），避免无输出文件触发 abort()
      await exec(["-hide_banner", "-i", name, "-t", "0.001", "-f", "null", "-"]);
      return parseProbe(logs);
    } catch {
      // 容错：即使有轻微告警，也尝试从已输出日志中提取流信息
      return parseProbe(logs);
    } finally {
      logSink = null;
      await removeFile(name);
    }
  });
}

export interface RunParams {
  /** 需要写入虚拟文件系统的输入文件 */
  inputs: { name: string; file: File }[];
  /** 完整的 ffmpeg 参数（包含输出文件名） */
  args: string[];
  /** 输出文件名 */
  outputName: string;
  onProgress?: (p: number) => void;
  onLog?: (line: string) => void;
  onStatus?: StatusCallback;
}

/** 运行一次 ffmpeg 任务，返回输出文件的二进制数据 */
export function runFFmpeg(params: RunParams): Promise<Uint8Array> {
  return enqueue(async () => {
    await ensureFFmpeg(params.onStatus);
    const logs: string[] = [];
    logSink = (line) => {
      logs.push(line);
      if (logs.length > 500) logs.shift();
      params.onLog?.(line);
    };
    progressSink = (p) => params.onProgress?.(p);

    try {
      for (const input of params.inputs) {
        await writeInput(input.name, input.file);
      }
      const code = await exec(["-hide_banner", "-y", ...params.args]);
      if (code !== 0) {
        const tail = logs.slice(-12).join("\n");
        throw new Error(`FFmpeg 执行失败（退出码 ${code}）\n${tail}`);
      }
      const out = await call<Uint8Array>("READ_FILE", { path: params.outputName });
      params.onProgress?.(1);
      return out;
    } catch (err: unknown) {
      const errStr = err instanceof Error ? err.message : String(err);
      if (
        errStr.includes("memory access out of bounds") ||
        errStr.includes("abort") ||
        errStr.includes("Aborted")
      ) {
        dispose(err instanceof Error ? err : new Error(errStr));
      }
      throw err;
    } finally {
      logSink = null;
      progressSink = null;
      for (const input of params.inputs) {
        await removeFile(input.name);
      }
      await removeFile(params.outputName);
    }
  });
}
