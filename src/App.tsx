import { useState } from "react";
import {
  CATEGORIES,
  TOOLS,
  changeValue,
  getDefaults,
  getTool,
  type FieldValue,
  type Values,
} from "./lib/tools";
import Sidebar from "./components/Sidebar";
import FileDropZone from "./components/FileDropZone";
import FieldControl from "./components/FieldControl";
import ResultPanel from "./components/ResultPanel";
import BatchDropZone from "./components/BatchDropZone";
import BatchResults from "./components/BatchResults";
import MergeStitchPanel from "./components/MergeStitchPanel";
import ThemeToggle from "./components/ThemeToggle";
import MobileDrawer from "./components/MobileDrawer";
import { useTheme } from "./utils/theme";
import { useMediaRunner } from "./hooks/useMediaRunner";

export default function App() {
  const { theme, setTheme } = useTheme();
  const [drawerOpen, setDrawerOpen] = useState(() => {
    if (typeof window !== "undefined") {
      return new URLSearchParams(window.location.search).get("drawer") === "open";
    }
    return false;
  });
  const [toolId, setToolId] = useState(() => {
    if (typeof window !== "undefined") {
      const q = new URLSearchParams(window.location.search).get("tool");
      if (q && TOOLS.some((t) => t.id === q)) return q;
    }
    return TOOLS[0].id;
  });
  const tool = getTool(toolId);
  const [valuesMap, setValuesMap] = useState<Record<string, Values>>({});
  const values: Values = valuesMap[tool.id] ?? getDefaults(tool);

  const {
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
    handleStart,
    handleCancel,
    retryCore,
    resetForTool,
    useResultAs,
    setError,
  } = useMediaRunner(tool, values, (newId) => setToolId(newId));

  function selectTool(id: string) {
    if (running || id === toolId) return;
    const t = getTool(id);
    setToolId(id);
    resetForTool(t);
  }

  function setValue(key: string, v: FieldValue) {
    setValuesMap((prev) => {
      const cur = prev[tool.id] ?? getDefaults(tool);
      return { ...prev, [tool.id]: changeValue(tool, cur, key, v) };
    });
  }

  const categoryLabel = CATEGORIES.find((c) => c.id === tool.category)?.label ?? "";
  const visibleFields = tool.fields
    .filter((f) => !f.visibleWhen || f.visibleWhen(values))
    .map((f) => (f.optionsFor ? { ...f, options: f.optionsFor(values) } : f));

  return (
    <div className="min-h-screen bg-slate-50/70 text-slate-800 transition-colors duration-200 dark:bg-slate-950 dark:text-slate-100">
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/85 backdrop-blur transition-colors dark:border-slate-800/80 dark:bg-slate-900/85">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-3 py-2.5 sm:px-4 sm:py-3">
          <div className="flex min-w-0 items-center gap-2 sm:gap-2.5">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-700 transition hover:bg-slate-100 active:scale-95 lg:hidden dark:border-slate-800 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              title="打开工具菜单"
              aria-label="打开工具菜单"
            >
              ☰
            </button>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-base text-white shadow-sm ring-1 ring-slate-800/10 dark:bg-blue-600 dark:ring-0 sm:h-10 sm:w-10 sm:text-lg">
              🎞️
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-bold tracking-tight text-slate-900 sm:text-lg dark:text-white">
                在线 FFmpeg 工具箱
              </h1>
              <p className="hidden text-xs text-slate-500 sm:block dark:text-slate-400">
                基于 FFmpeg.wasm · 浏览器本地处理 · 文件不会上传到服务器
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 text-xs sm:gap-3">
            <ThemeToggle theme={theme} onChange={setTheme} />
            <div className="flex items-center gap-1.5">
              <span
                className={`h-2 w-2 rounded-full ${
                  coreError
                    ? "bg-rose-500"
                    : coreMsg
                      ? "animate-pulse bg-amber-400"
                      : coreReady
                        ? "bg-emerald-500"
                        : "bg-slate-300"
                }`}
              />
              {coreError ? (
                <span className="flex items-center gap-1">
                  <span className="font-medium text-rose-600 dark:text-rose-400">失败</span>
                  <button
                    type="button"
                    onClick={retryCore}
                    className="rounded-md bg-rose-600 px-2 py-0.5 font-medium text-white hover:bg-rose-700"
                  >
                    重试
                  </button>
                </span>
              ) : (
                <span className="hidden max-w-[140px] truncate text-slate-600 sm:inline sm:max-w-[240px] dark:text-slate-300">
                  {coreMsg || (coreReady ? "FFmpeg 已就绪" : "FFmpeg 加载中…")}
                </span>
              )}
            </div>
          </div>
        </div>
      </header>

      {coreError && (
        <div className="mx-auto mt-4 max-w-7xl px-4">
          <div className="animate-shake rounded-xl border border-rose-200 bg-rose-50 p-4 dark:border-rose-900/60 dark:bg-rose-950/40">
            <p className="text-sm font-semibold text-rose-700 dark:text-rose-300">FFmpeg 核心加载失败</p>
            <pre className="mt-2 whitespace-pre-wrap break-all text-xs text-rose-600 dark:text-rose-400">{coreError}</pre>
            <p className="mt-2 text-xs text-rose-500 dark:text-rose-400">
              可尝试：刷新页面；使用最新版 Chrome / Edge / Firefox；确认浏览器未禁用 WebAssembly 或 Worker。
            </p>
          </div>
        </div>
      )}

      <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[260px_1fr]">
        <aside className="hidden rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/80 transition-colors lg:block lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:self-start lg:overflow-y-auto dark:bg-slate-900 dark:ring-slate-800">
          <Sidebar activeId={tool.id} disabled={running} onSelect={selectTool} />
        </aside>

        <section className="min-w-0 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/80 transition-colors sm:p-8 dark:bg-slate-900 dark:ring-slate-800">
          <MobileDrawer
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            activeId={tool.id}
            disabled={running}
            onSelect={selectTool}
          />

          {/* 移动端顶部快捷换工具条 */}
          <div className="mb-5 flex items-center justify-between gap-3 rounded-2xl border border-slate-200/90 bg-slate-50/80 p-3 lg:hidden dark:border-slate-800 dark:bg-slate-800/50">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="text-2xl">{tool.icon}</span>
              <div className="min-w-0">
                <div className="truncate text-sm font-bold text-slate-900 dark:text-slate-100">{tool.name}</div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">点击右侧按钮更换工具</div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-800 active:scale-95 dark:bg-blue-600 dark:hover:bg-blue-500"
            >
              <span>☰ 切换工具</span>
              <span className="rounded-full bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-200 dark:bg-blue-500 dark:text-white">
                {TOOLS.length}
              </span>
            </button>
          </div>

          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-5 dark:border-slate-800">
            <div>
              <div className="flex items-center gap-3">
                <span className="text-3xl">{tool.icon}</span>
                <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{tool.name}</h2>
              </div>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{tool.desc}</p>
            </div>
            <div className="flex gap-2">
              {tool.multiple && (
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:ring-emerald-800">
                  支持批量
                </span>
              )}
              {tool.mergeList && (
                <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 ring-1 ring-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:ring-blue-800">
                  支持多图拼长图
                </span>
              )}
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-200/80 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700">
                {categoryLabel}
              </span>
            </div>
          </div>

          {tool.mergeList ? (
            <div className="mt-6">
              <MergeStitchPanel
                items={mergeFiles}
                disabled={running}
                onAdd={addMergeFiles}
                onRemove={removeMergeFile}
                onMove={moveMergeFile}
                onClear={clearMergeFiles}
              />
            </div>
          ) : tool.multiple ? (
            <div className="mt-6">
              <BatchDropZone
                accept={tool.accept[0]}
                items={batch}
                disabled={running}
                onAdd={(files) => void addBatchFiles(files)}
                onRemove={removeBatchItem}
                onClear={clearBatch}
              />
              {inputCount > 1 && (
                <div className="mt-5">
                  <FileDropZone
                    label={tool.inputLabels[1] ?? "附加文件"}
                    accept={tool.accept[1]}
                    file={slots[1].file}
                    info={slots[1].info}
                    probing={slots[1].probing}
                    onFile={(f) => void handleFile(1, f)}
                  />
                </div>
              )}
            </div>
          ) : (
            <div className={`mt-6 grid gap-5 ${inputCount > 1 ? "md:grid-cols-2" : ""}`}>
              {tool.accept.slice(0, inputCount).map((acc, i) => (
                <FileDropZone
                  key={`${tool.id}-${i}`}
                  label={tool.inputLabels[i] ?? `文件 ${i + 1}`}
                  accept={acc}
                  file={slots[i].file}
                  info={slots[i].info}
                  probing={slots[i].probing}
                  onFile={(f) => void handleFile(i, f)}
                />
              ))}
            </div>
          )}

          {visibleFields.length > 0 && (
            <div className="mt-8">
              <h3 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">处理参数</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                {visibleFields.map((f) => (
                  <div
                    key={f.key}
                    className={
                      f.type === "presets" || f.type === "chips" || f.type === "text" ? "sm:col-span-2" : undefined
                    }
                  >
                    <FieldControl field={f} value={values[f.key]} onChange={(v) => setValue(f.key, v)} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {tool.outputHint && (
            <p className="mt-4 rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-2.5 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-300">
              📐 {tool.outputHint(values, tool.multiple ? [batch[0]?.info ?? null] : slots.map((s) => s.info))}
              {tool.multiple && batch.length > 1 && (
                <span className="ml-1 text-slate-500 dark:text-slate-400">（以第 1 张估算，批量时每张按各自尺寸计算）</span>
              )}
            </p>
          )}

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleStart}
              disabled={!canRun || running}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-blue-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none dark:bg-blue-600 dark:hover:bg-blue-500"
            >
              {running
                ? "⏳ 处理中…"
                : tool.multiple && batch.length > 1
                  ? `▶ 开始批量处理（${batch.length} 个文件）`
                  : tool.mergeList && mergeFiles.length > 1
                    ? `▶ 开始拼接（共 ${mergeFiles.length} 张图片）`
                    : "▶ 开始处理"}
            </button>
            {running && (
              <button
                type="button"
                onClick={handleCancel}
                className="rounded-xl border border-rose-200 px-5 py-3 text-sm font-medium text-rose-600 transition-all hover:bg-rose-50 active:scale-95 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950/50"
              >
                取消
              </button>
            )}
            {!canRun && !running && (
              <span className="text-xs text-slate-400 dark:text-slate-500">
                {tool.mergeList
                  ? mergeFiles.length === 0
                    ? "请添加至少 2 张待拼接图片"
                    : mergeFiles.length === 1
                      ? "请继续添加至少 1 张图片"
                      : "准备就绪，点击开始拼接"
                  : tool.multiple
                    ? batch.length === 0
                      ? "请先添加待处理文件"
                      : "正在读取文件信息…"
                    : tool.accept.length > 1
                      ? "请先选择所有输入文件"
                      : "请先选择输入文件"}
              </span>
            )}
          </div>

          {tool.multiple ? (
            <BatchResults items={batch} running={running} onError={setError} />
          ) : (
            running && (
              <div className="mt-4">
                <div className="mb-1.5 flex justify-between text-xs text-slate-500 dark:text-slate-400">
                  <span>{coreMsg || "正在处理，请勿关闭页面"}</span>
                  {progress > 0 && <span className="tabular-nums">{Math.round(Math.min(progress, 1) * 100)}%</span>}
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div
                    className={`h-full rounded-full bg-blue-600 transition-all duration-300 ${
                      progress > 0 ? "" : "w-1/3 animate-pulse"
                    }`}
                    style={progress > 0 ? { width: `${Math.min(progress, 1) * 100}%` } : undefined}
                  />
                </div>
              </div>
            )
          )}

          {error && (
            <div className="animate-shake mt-6 rounded-xl border border-rose-200 bg-rose-50 p-4 dark:border-rose-900/60 dark:bg-rose-950/40">
              <p className="text-sm font-semibold text-rose-700 dark:text-rose-300">出错了</p>
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs text-rose-600 dark:text-rose-400">
                {error}
              </pre>
            </div>
          )}

          {!tool.multiple && result && (
            <ResultPanel
              result={result}
              currentToolId={tool.id}
              targets={chainTargets}
              onUseAsInput={useResultAs}
            />
          )}

          {logs.length > 0 && (
            <details className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-800 dark:bg-slate-950/50">
              <summary className="cursor-pointer font-medium text-slate-600 dark:text-slate-300">
                FFmpeg 日志（最近 {logs.length} 行）
              </summary>
              <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-5 text-slate-500 dark:text-slate-400">
                {logs.join("\n")}
              </pre>
            </details>
          )}
        </section>
      </main>

      <footer className="mx-auto max-w-7xl px-4 pb-12 text-center text-xs leading-6 text-slate-400 dark:text-slate-500 [padding-bottom:max(env(safe-area-inset-bottom),3rem)]">
        FFmpeg 核心已内置于页面中，无需联网下载。浏览器端为单线程 WebAssembly，处理高清视频或大文件会比较耗时，建议单个文件不超过 500MB。
      </footer>
    </div>
  );
}
