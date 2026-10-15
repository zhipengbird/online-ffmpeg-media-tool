import { useEffect, useState } from "react";
import type { ToolDef } from "../lib/tools";
import { formatBytes } from "../utils/format";

export interface ResultData {
  url: string;
  file: File;
  name: string;
  mime: string;
  size: number;
  inputSize: number;
}

interface Props {
  result: ResultData;
  /** 当前工具 id，用于标注"当前工具" */
  currentToolId: string;
  /** 能够接收该输出文件作为输入的工具列表 */
  targets: ToolDef[];
  onUseAsInput: (toolId: string) => void;
  /** 处理耗时（秒） */
  elapsed?: number;
}

export default function ResultPanel({ result, currentToolId, targets, onUseAsInput, elapsed }: Props) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [isZoomed, setIsZoomed] = useState(false);

  const kind = result.mime.split("/")[0];
  const isImageOrGif = kind === "image" || result.mime === "image/gif";

  const diffBytes = Math.abs(result.size - result.inputSize);
  const ratio = result.inputSize > 0 ? Math.round((result.size / result.inputSize) * 100) : 0;
  const isSmaller = result.size < result.inputSize;
  const isBigger = result.size > result.inputSize;

  // 监听 ESC 键关闭全屏灯箱
  useEffect(() => {
    if (!lightboxOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [lightboxOpen]);

  // 当灯箱打开时，禁止背景页面滚动
  useEffect(() => {
    if (lightboxOpen) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [lightboxOpen]);

  return (
    <>
      <div className="animate-pop-in mt-8 overflow-hidden rounded-2xl border border-emerald-200 bg-emerald-50/40 shadow-sm dark:border-emerald-800/60 dark:bg-emerald-950/20">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-emerald-100 bg-white/80 px-5 py-3 dark:border-emerald-900/60 dark:bg-slate-900/80">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500 text-sm text-white shadow-sm">
              ✓
            </span>
            <h3 className="font-semibold text-slate-800 dark:text-slate-100">处理完成</h3>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            {result.inputSize > 0 && (
              <>
                <span className="tabular-nums rounded-md bg-white px-2 py-1 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700">
                  原始 {formatBytes(result.inputSize)}
                </span>
                <span>→</span>
              </>
            )}
            <span
              className={`tabular-nums rounded-md px-2 py-1 font-medium ring-1 ${
                isSmaller
                  ? "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:ring-emerald-800"
                  : isBigger
                    ? "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:ring-amber-800"
                    : "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700"
              }`}
            >
              输出 {formatBytes(result.size)}
              {result.inputSize > 0 && (
                <>
                  {isSmaller && `（↓ 节省 ${100 - ratio}%，-${formatBytes(diffBytes)}）`}
                  {isBigger && `（↑ 增大 ${ratio - 100}%，+${formatBytes(diffBytes)}）`}
                  {!isSmaller && !isBigger && "（大小持平）"}
                </>
              )}
            </span>
            {elapsed != null && elapsed > 0 && (
              <span className="tabular-nums rounded-md bg-slate-100 px-2 py-1 text-slate-600 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700">
                ⏱ 耗时 {elapsed}s
              </span>
            )}
          </div>
        </div>

        <div className="space-y-5 p-5">
          {/* 媒体展示框 */}
          <div className="relative group flex items-center justify-center rounded-xl bg-slate-950 p-3 ring-1 ring-slate-800 overflow-hidden">
            {kind === "video" && (
              <video key={result.url} src={result.url} controls className="max-h-[420px] w-full rounded-lg" />
            )}
            {kind === "audio" && <audio key={result.url} src={result.url} controls className="w-full" />}
            {isImageOrGif && (
              <div
                onClick={() => {
                  setIsZoomed(false);
                  setLightboxOpen(true);
                }}
                className="cursor-zoom-in relative max-h-[420px] flex items-center justify-center"
                title="点击全屏查看原图"
              >
                <img
                  src={result.url}
                  alt="输出结果"
                  className="max-h-[420px] max-w-full rounded-lg object-contain transition-transform duration-200 group-hover:scale-[1.01]"
                />
                <div className="pointer-events-none absolute bottom-2 right-2 rounded-lg bg-black/70 px-2 py-1 text-[11px] font-medium text-white/90 backdrop-blur-xs opacity-0 transition-opacity duration-200 group-hover:opacity-100 flex items-center gap-1">
                  <span>🔍 点击全屏大图</span>
                </div>
              </div>
            )}
          </div>

          {/* 操作按钮栏 */}
          <div className="flex flex-wrap items-center gap-3">
            <a
              href={result.url}
              download={result.name}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-emerald-200 transition-all hover:bg-emerald-700 active:scale-[0.98] dark:bg-emerald-600 dark:shadow-none dark:hover:bg-emerald-500"
            >
              ⬇️ 下载 {result.name}
            </a>

            {isImageOrGif && (
              <button
                type="button"
                onClick={() => {
                  setIsZoomed(false);
                  setLightboxOpen(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-xs transition hover:bg-slate-50 hover:text-slate-900 active:scale-95 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 dark:hover:text-white"
              >
                🔍 全屏查看大图
              </button>
            )}
          </div>

          {/* 链式作为输入 */}
          <div className="border-t border-emerald-100/70 pt-4 dark:border-emerald-900/40">
            <p className="mb-2.5 text-sm font-medium text-slate-700 dark:text-slate-200">🔁 作为输入，继续处理</p>
            {targets.length === 0 ? (
              <p className="text-xs text-slate-400 dark:text-slate-500">没有可以接收该文件类型的工具。</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  {targets.map((t) => {
                    const isCurrent = t.id === currentToolId;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => onUseAsInput(t.id)}
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-all active:scale-95 ${
                          isCurrent
                            ? "border-blue-600 bg-blue-600 font-medium text-white shadow-sm hover:bg-blue-700 dark:border-blue-500 dark:bg-blue-600"
                            : "border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:text-white"
                        }`}
                      >
                        <span>{t.icon}</span>
                        <span>{t.name}</span>
                        {isCurrent && <span className="text-xs opacity-80">（当前）</span>}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
                  只显示类型匹配的工具。点击后会自动切换到该工具并载入此文件。
                </p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Lightbox 全屏预览 Modal */}
      {lightboxOpen && isImageOrGif && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-slate-950/90 backdrop-blur-md transition-all duration-200"
          role="dialog"
          aria-modal="true"
        >
          {/* 顶栏控制栏 */}
          <div className="flex items-center justify-between border-b border-white/10 bg-black/40 px-4 py-3 text-white">
            <div className="flex items-center gap-3 min-w-0">
              <span className="truncate text-sm font-semibold">{result.name}</span>
              <span className="hidden sm:inline text-xs text-slate-400">({formatBytes(result.size)})</span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsZoomed((z) => !z)}
                className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-white/20 active:scale-95"
                title={isZoomed ? "适应窗口" : "1:1 原始尺寸"}
              >
                {isZoomed ? "🔍 适应窗口" : "🔍 100% 原始大小"}
              </button>
              <a
                href={result.url}
                download={result.name}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white shadow-xs transition hover:bg-emerald-500 active:scale-95"
              >
                ⬇️ 下载
              </a>
              <button
                type="button"
                onClick={() => setLightboxOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-sm text-slate-300 transition hover:bg-white/20 hover:text-white active:scale-95"
                title="关闭 (Esc)"
              >
                ✕
              </button>
            </div>
          </div>

          {/* 图像居中视口 */}
          <div
            className="flex-1 overflow-auto flex items-center justify-center p-4 cursor-pointer select-none"
            onClick={(e) => {
              if (e.target === e.currentTarget) setLightboxOpen(false);
            }}
          >
            <img
              src={result.url}
              alt={result.name}
              onClick={() => setIsZoomed((z) => !z)}
              className={`rounded shadow-2xl transition-all duration-200 ${
                isZoomed
                  ? "max-w-none cursor-zoom-out"
                  : "max-h-[85vh] max-w-[90vw] object-contain cursor-zoom-in"
              }`}
              title={isZoomed ? "点击适应屏幕" : "点击放大至原始像素"}
            />
          </div>

          {/* 底栏提示 */}
          <div className="py-2 text-center text-[11px] text-slate-400 bg-black/40 border-t border-white/5">
            按 ESC 键或点击空白区域关闭 · 点击图片切换 100% / 窗口适应
          </div>
        </div>
      )}
    </>
  );
}
