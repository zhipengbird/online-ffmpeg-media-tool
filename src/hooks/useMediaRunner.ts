import { useEffect, useRef, useState } from "react";
import {
  prepareInputs,
  TOOLS,
  type ToolDef,
  type Values,
} from "../lib/tools";
import {
  ensureFFmpeg,
  isFFmpegReady,
  probeMedia,
  runFFmpeg,
  terminateFFmpeg,
  type MediaInfo,
} from "../lib/ffmpeg";
import {
  createBatchItem,
  resetBatchItems,
  revokeBatchResults,
  type BatchItem,
} from "../lib/batch";
import type { ResultData } from "../components/ResultPanel";
import type { MergeItem } from "../components/MergeStitchPanel";
import { extOf, stem } from "../utils/format";
import { matchesAccept } from "../utils/accept";

export interface Slot {
  file: File | null;
  info: MediaInfo | null;
  probing: boolean;
}

export const makeSlots = (n: number): Slot[] =>
  Array.from({ length: n }, () => ({ file: null, info: null, probing: false }));

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function useMediaRunner(tool: ToolDef, values: Values, onSwitchTool: (toolId: string) => void) {
  // 单文件模式的输入槽位
  const [slots, setSlots] = useState<Slot[]>(() => makeSlots(tool.accept.length));
  // 批量模式的文件列表（仅 tool.multiple 为 true 时使用）
  const [batch, setBatch] = useState<BatchItem[]>([]);
  // 多图拼接模式的文件列表（仅 tool.mergeList 为 true 时使用）
  const [mergeFiles, setMergeFiles] = useState<MergeItem[]>([]);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [coreMsg, setCoreMsg] = useState("");
  const [coreReady, setCoreReady] = useState(false);
  const [coreError, setCoreError] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<ResultData | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  const runIdRef = useRef(0);
  const logBufRef = useRef<string[]>([]);
  const logTimerRef = useRef<number | null>(null);

  // 释放上一次输出的 Blob URL，避免内存泄漏
  useEffect(() => {
    return () => {
      if (result) URL.revokeObjectURL(result.url);
    };
  }, [result]);

  useEffect(() => {
    return () => {
      if (logTimerRef.current) clearInterval(logTimerRef.current);
    };
  }, []);

  // 释放多图拼接的预览图 URL
  useEffect(() => {
    return () => {
      for (const it of mergeFiles) URL.revokeObjectURL(it.previewUrl);
    };
  }, [mergeFiles]);

  // 启动时立即在后台加载 FFmpeg 核心；失败时在页面顶部展示原因，并允许重试
  function retryCore() {
    setCoreError("");
    ensureFFmpeg(setCoreMsg)
      .then(() => setCoreReady(true))
      .catch((e: unknown) => setCoreError(errMsg(e)));
  }

  useEffect(() => {
    retryCore();
  }, []);

  // 本次任务需要的输入数量（如水印：文字模式 1 张，图片模式 2 张）
  const inputCount = tool.inputCount ? tool.inputCount(values) : tool.accept.length;
  // 第 2 个及之后的槽位：单文件模式为普通输入；批量模式为所有图片共享的附加文件（如水印 Logo）
  const extraReady = slots.slice(1, inputCount).every((s) => s.file !== null && !s.probing);
  const canRun = tool.mergeList
    ? mergeFiles.length >= (tool.id === "video-img2vid" || tool.id === "image-gif" ? 1 : 2) && extraReady && !running
    : tool.multiple
      ? batch.length > 0 && batch.every((i) => !i.probing) && extraReady
      : slots.slice(0, inputCount).every((s) => s.file !== null && !s.probing);

  function startLogTimer() {
    if (logTimerRef.current) clearInterval(logTimerRef.current);
    logTimerRef.current = window.setInterval(() => {
      setLogs(logBufRef.current.slice(-300));
    }, 400);
  }

  function stopLogTimer() {
    if (logTimerRef.current) {
      clearInterval(logTimerRef.current);
      logTimerRef.current = null;
    }
    setLogs(logBufRef.current.slice(-300));
  }

  function resetForTool(newTool: ToolDef) {
    revokeBatchResults(batch);
    setBatch([]);
    for (const it of mergeFiles) URL.revokeObjectURL(it.previewUrl);
    setMergeFiles([]);
    setSlots(makeSlots(newTool.accept.length));
    setResult(null);
    setError("");
    setLogs([]);
    setProgress(0);
  }

  /* ---------------- 单文件模式 ---------------- */

  async function handleFile(index: number, file: File | null, t: ToolDef = tool) {
    if (running) return;
    // 类型不符时拒绝载入（拖拽不受 <input accept> 限制，需要在这里校验）
    if (file && !matchesAccept(t.accept[index], file)) {
      setError(`「${file.name}」不是「${t.name}」支持的文件类型，请选择${t.inputLabels[index] ?? "正确的文件"}。`);
      return;
    }
    setResult(null);
    setError("");
    setSlots((prev) =>
      prev.map((s, i) => (i === index ? { file, info: null, probing: file !== null } : s))
    );
    if (!file) return;

    try {
      const info = await probeMedia(file, (msg) => setCoreMsg(msg));
      if (isFFmpegReady()) {
        setCoreReady(true);
      }
      setCoreMsg("");
      setSlots((prev) =>
        prev.map((s, i) => (i === index && s.file === file ? { ...s, info, probing: false } : s))
      );
    } catch (e) {
      setCoreMsg("");
      setSlots((prev) =>
        prev.map((s, i) => (i === index && s.file === file ? { ...s, probing: false } : s))
      );
      setError(`读取文件信息失败：${errMsg(e)}`);
    }
  }

  async function handleRun() {
    if (running || !canRun) return;
    const runId = ++runIdRef.current;
    const files = tool.mergeList
      ? [...mergeFiles.map((m) => m.file), ...slots.slice(1, inputCount).map((s) => s.file as File)]
      : slots.slice(0, inputCount).map((s) => s.file as File);

    setRunning(true);
    setProgress(0);
    setError("");
    setResult(null);
    logBufRef.current = [];
    setLogs([]);
    startLogTimer();

    try {
      // 统一生成 FFmpeg 输入：前置处理（证件照）+ 叠加图层（文字水印）
      const sources = await prepareInputs(tool, files, values);
      const names = sources.map((f, i) => `input${i}.${extOf(f.name)}`);
      const plan = tool.build({ values, inputs: names, infos: tool.mergeList ? [] : slots.map((s) => s.info) });
      const outputName = `output.${plan.ext}`;

      const data = await runFFmpeg({
        inputs: sources.map((file, i) => ({ name: names[i], file })),
        args: [...plan.args, outputName],
        outputName,
        onProgress: (p) => {
          if (runIdRef.current === runId) setProgress(p);
        },
        onLog: (line) => {
          if (runIdRef.current === runId) logBufRef.current.push(line);
        },
        onStatus: (msg) => {
          if (runIdRef.current === runId) setCoreMsg(msg);
        },
      });

      if (runIdRef.current !== runId) return;

      const blob = new Blob([new Uint8Array(data)], { type: plan.mime });
      const name = tool.mergeList
        ? `merged-${Date.now()}.${plan.ext}`
        : `${stem(files[0].name)}-${tool.id}.${plan.ext}`;
      const outFile = new File([blob], name, { type: plan.mime });
      setResult({
        url: URL.createObjectURL(blob),
        file: outFile,
        name,
        mime: plan.mime,
        size: blob.size,
        inputSize: files.reduce((sum, f) => sum + f.size, 0),
      });
      setCoreReady(true);
      setProgress(1);
    } catch (e) {
      if (runIdRef.current === runId) setError(errMsg(e));
    } finally {
      if (runIdRef.current === runId) {
        setRunning(false);
        stopLogTimer();
      }
    }
  }

  /* ---------------- 批量模式 ---------------- */

  async function addBatchFiles(input: File[], t: ToolDef = tool) {
    if (running) return;
    // 过滤掉当前工具不支持的文件类型
    const files = input.filter((f) => matchesAccept(t.accept[0], f));
    const rejected = input.length - files.length;
    if (rejected > 0) {
      const typeName = t.category === "video" ? "视频" : t.category === "audio" ? "音频" : "图片";
      setError(`已忽略 ${rejected} 个不支持的文件（${t.name}仅支持${typeName}格式）。`);
    }
    if (files.length === 0) return;
    // 文件列表变化后，之前的处理结果不再对应，需要清空
    revokeBatchResults(batch);
    if (rejected === 0) setError("");
    setResult(null);

    const added = files.map(createBatchItem);
    setBatch((prev) => [
      ...prev.map((i) => ({ ...i, status: "idle" as const, progress: 0, error: undefined, result: undefined })),
      ...added,
    ]);

    // 逐个读取媒体信息（尺寸用于预估输出与宽高比计算）
    for (const item of added) {
      try {
        const info = await probeMedia(item.file, (msg) => setCoreMsg(msg));
        if (isFFmpegReady()) {
          setCoreReady(true);
        }
        setBatch((prev) => prev.map((i) => (i.id === item.id ? { ...i, info, probing: false } : i)));
      } catch (e) {
        setBatch((prev) => prev.map((i) => (i.id === item.id ? { ...i, probing: false } : i)));
        setError(`读取 ${item.file.name} 的信息失败：${errMsg(e)}`);
      }
    }
    setCoreMsg("");
  }

  function removeBatchItem(id: string) {
    if (running) return;
    const target = batch.find((i) => i.id === id);
    if (target?.result) URL.revokeObjectURL(target.result.url);
    setBatch((prev) => prev.filter((i) => i.id !== id));
  }

  function clearBatch() {
    if (running) return;
    revokeBatchResults(batch);
    setBatch([]);
    setError("");
  }

  async function handleBatchRun() {
    if (running || !canRun) return;
    const runId = ++runIdRef.current;
    const queue = resetBatchItems(batch);
    const snapshot = values;

    // 批量模式下，第 2 个及之后的槽位是所有图片共享的附加文件（如水印 Logo）
    const sharedCount = tool.inputCount ? tool.inputCount(snapshot) : 1;
    const sharedFiles = slots.slice(1, sharedCount).map((s) => s.file as File);

    setBatch(queue);
    setRunning(true);
    setError("");
    setResult(null);
    logBufRef.current = [];
    setLogs([]);
    startLogTimer();

    // 仅在当前任务仍有效时更新某一项的状态
    const patch = (id: string, p: Partial<BatchItem>) => {
      if (runIdRef.current !== runId) return;
      setBatch((prev) => prev.map((i) => (i.id === id ? { ...i, ...p } : i)));
    };

    for (const item of queue) {
      if (runIdRef.current !== runId) break;
      patch(item.id, { status: "running", progress: 0 });

      try {
        // 在 FFmpeg 之前生成全部输入（前置处理 + 叠加图层），其文件名与格式由实际输入决定
        const sources = await prepareInputs(tool, [item.file, ...sharedFiles], snapshot);
        const names = sources.map((f, i) => `input${i}.${extOf(f.name)}`);
        const plan = tool.build({ values: snapshot, inputs: names, infos: [item.info] });
        const outputName = `output.${plan.ext}`;

        const data = await runFFmpeg({
          inputs: sources.map((file, i) => ({ name: names[i], file })),
          args: [...plan.args, outputName],
          outputName,
          onProgress: (p) => patch(item.id, { progress: p }),
          onLog: (line) => {
            if (runIdRef.current === runId) logBufRef.current.push(line);
          },
          onStatus: (msg) => {
            if (runIdRef.current === runId) setCoreMsg(msg);
          },
        });

        if (runIdRef.current !== runId) break;

        const blob = new Blob([new Uint8Array(data)], { type: plan.mime });
        patch(item.id, {
          status: "done",
          progress: 1,
          result: {
            url: URL.createObjectURL(blob),
            name: `${stem(item.file.name)}-${tool.id}.${plan.ext}`,
            mime: plan.mime,
            size: blob.size,
          },
        });
      } catch (e) {
        if (runIdRef.current !== runId) break;
        patch(item.id, { status: "error", progress: 0, error: errMsg(e) });
      }
    }

    if (runIdRef.current === runId) {
      setRunning(false);
      setCoreReady(true);
      stopLogTimer();
    }
  }

  function handleStart() {
    if (tool.multiple) void handleBatchRun();
    else void handleRun();
  }

  function handleCancel() {
    runIdRef.current++; // 使当前任务的回调失效
    terminateFFmpeg();
    // 正在处理的那一项标记为已取消，其余保持等待
    setBatch((prev) =>
      prev.map((i) => (i.status === "running" ? { ...i, status: "cancelled", progress: 0 } : i))
    );
    setCoreReady(false);
    setCoreMsg("");
    setRunning(false);
    stopLogTimer();
    setError("已取消处理。FFmpeg 核心正在后台重新加载。");
    retryCore();
  }

  // 将当前结果作为输入，切换到用户选择的工具继续处理
  function useResultAs(targetId: string) {
    if (!result || running) return;
    const file = result.file;
    const t = TOOLS.find((item) => item.id === targetId);
    if (!t) return;
    onSwitchTool(targetId);
    resetForTool(t);
    if (t.multiple) void addBatchFiles([file], t);
    else void handleFile(0, file, t);
  }

  // 只列出接收类型与该结果匹配的单输入工具
  const chainTargets = result
    ? TOOLS.filter((t) => t.accept.length === 1 && matchesAccept(t.accept[0], result.file))
    : [];

  /* ---------------- 多图拼接模式 ---------------- */

  function addMergeFiles(input: File[]) {
    if (running) return;
    const valid = input.filter((f) => matchesAccept(tool.accept[0], f));
    if (valid.length === 0) return;
    const added: MergeItem[] = valid.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    setMergeFiles((prev) => [...prev, ...added]);
    setError("");
    setResult(null);
  }

  function removeMergeFile(id: string) {
    if (running) return;
    setMergeFiles((prev) => {
      const it = prev.find((i) => i.id === id);
      if (it) URL.revokeObjectURL(it.previewUrl);
      return prev.filter((i) => i.id !== id);
    });
  }

  function moveMergeFile(index: number, direction: -1 | 1) {
    if (running) return;
    setMergeFiles((prev) => {
      const targetIdx = index + direction;
      if (targetIdx < 0 || targetIdx >= prev.length) return prev;
      const next = [...prev];
      const temp = next[index];
      next[index] = next[targetIdx];
      next[targetIdx] = temp;
      return next;
    });
  }

  function clearMergeFiles() {
    if (running) return;
    for (const it of mergeFiles) URL.revokeObjectURL(it.previewUrl);
    setMergeFiles([]);
  }

  function setCustomResult(file: File) {
    if (running) return;
    setResult((prev) => {
      if (prev?.url) URL.revokeObjectURL(prev.url);
      return {
        url: URL.createObjectURL(file),
        file,
        name: file.name,
        mime: file.type || "application/octet-stream",
        size: file.size,
        inputSize: file.size,
      };
    });
    setError("");
    setProgress(1);
  }

  return {
    slots,
    batch,
    mergeFiles,
    running,
    progress,
    coreMsg,
    coreReady,
    coreError,
    error,
    result,
    logs,
    inputCount,
    canRun,
    chainTargets,
    handleFile,
    addBatchFiles,
    removeBatchItem,
    clearBatch,
    addMergeFiles,
    removeMergeFile,
    moveMergeFile,
    clearMergeFiles,
    setCustomResult,
    handleStart,
    handleCancel,
    retryCore,
    resetForTool,
    useResultAs,
    setError,
  };
}
