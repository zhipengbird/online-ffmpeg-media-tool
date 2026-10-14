// FFmpeg 核心运行环境（经典 Worker）
// 通过 Vite 的 ?worker&inline 内联进主包，不依赖额外的 worker 文件，
// 因此只分发 index.html 也能正常运行。
// 消息协议参考 @ffmpeg/ffmpeg 的 worker.js：请求 {id, type, data}，响应 {id, ok, data | error}。

interface FFCore {
  setLogger(fn: (e: { type: string; message: string }) => void): void;
  setProgress(fn: (e: { progress: number; time: number }) => void): void;
  setTimeout(ms: number): void;
  exec(...args: string[]): number;
  ret: number;
  reset(): void;
  FS: {
    writeFile(path: string, data: Uint8Array): void;
    readFile(path: string): Uint8Array;
    unlink(path: string): void;
  };
}

interface WorkerScope {
  createFFmpegCore?: (opts: Record<string, unknown>) => Promise<FFCore>;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
}

interface WorkerRequest {
  id: number;
  type: string;
  data?: unknown;
}

declare function importScripts(...urls: string[]): void;

const scope = self as unknown as WorkerScope;
let core: FFCore | null = null;

function requireCore(): FFCore {
  if (!core) throw new Error("FFmpeg 尚未加载");
  return core;
}

async function load(coreJs: string, wasm: ArrayBuffer): Promise<void> {
  if (core) return;

  if (!scope.createFFmpegCore) {
    try {
      // 在 Vite 开发模式或现代浏览器中，Worker 通常作为 ES Module 运行，
      // 而 Module Worker 规范明确禁止使用 importScripts()。
      // 使用 Function 动态解析 UMD 核心脚本，既支持 Module Worker 也支持 Classic Worker。
      const initCore = new Function(`${coreJs}\nreturn typeof createFFmpegCore !== 'undefined' ? createFFmpegCore : undefined;`);
      scope.createFFmpegCore = initCore();
    } catch {
      // 降级使用 Blob URL + importScripts（经典 Worker 场景）
      if (typeof importScripts === "function") {
        const url = URL.createObjectURL(new Blob([coreJs], { type: "text/javascript" }));
        try {
          importScripts(url);
        } finally {
          URL.revokeObjectURL(url);
        }
      }
    }
  }

  if (typeof scope.createFFmpegCore !== "function") {
    throw new Error("FFmpeg 核心脚本加载失败：未找到 createFFmpegCore");
  }

  // 直接传入 WASM 二进制，避免再次通过网络/URL 获取
  const instance = await scope.createFFmpegCore({ wasmBinary: wasm });
  instance.setLogger((e) => scope.postMessage({ type: "LOG", data: e.message }));
  instance.setProgress((e) => scope.postMessage({ type: "PROGRESS", data: e.progress }));
  core = instance;
}

function exec(args: string[], timeout: number): number {
  const c = requireCore();
  c.setTimeout(timeout);
  c.exec("-nostdin", ...args);
  const ret = c.ret;
  c.reset();
  return ret;
}

scope.onmessage = async (e) => {
  const { id, type, data } = e.data;
  try {
    let result: unknown = true;
    const transfer: Transferable[] = [];

    switch (type) {
      case "LOAD": {
        const d = data as { coreJs: string; wasm: ArrayBuffer };
        await load(d.coreJs, d.wasm);
        break;
      }
      case "EXEC": {
        const d = data as { args: string[]; timeout?: number };
        result = exec(d.args, d.timeout ?? -1);
        break;
      }
      case "WRITE_FILE": {
        const d = data as { path: string; data: Uint8Array };
        requireCore().FS.writeFile(d.path, d.data);
        break;
      }
      case "READ_FILE": {
        const d = data as { path: string };
        const out = requireCore().FS.readFile(d.path);
        result = out;
        transfer.push(out.buffer as ArrayBuffer);
        break;
      }
      case "DELETE_FILE": {
        const d = data as { path: string };
        requireCore().FS.unlink(d.path);
        break;
      }
      default:
        throw new Error(`未知的 Worker 消息类型: ${type}`);
    }

    scope.postMessage({ id, ok: true, data: result }, transfer);
  } catch (err) {
    scope.postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

export {};
