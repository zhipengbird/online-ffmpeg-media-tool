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
    if (msg.ok) p.resolve(msg.data);
    else p.reject(new Error(msg.error ?? "FFmpeg 执行出错"));
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

/** 读取媒体文件的基础信息（时长、是否有音视频轨、分辨率） */
export function probeMedia(file: File, onStatus?: StatusCallback): Promise<MediaInfo> {
  return enqueue(async () => {
    await ensureFFmpeg(onStatus);
    const name = "probe_input";
    const logs: string[] = [];
    logSink = (line) => logs.push(line);
    try {
      await writeInput(name, file);
      // 没有输出文件，ffmpeg 会返回非 0，但日志中包含完整的流信息
      await exec(["-hide_banner", "-i", name]);
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
