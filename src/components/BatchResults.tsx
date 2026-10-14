import { useEffect, useState } from "react";
import type { BatchItem } from "../lib/batch";
import { downloadBlob, zipFiles } from "../utils/download";
import { formatBytes } from "../utils/format";

interface Props {
  items: BatchItem[];
  running: boolean;
  onError: (msg: string) => void;
}

const STATUS_STYLE: Record<BatchItem["status"], { text: string; cls: string }> = {
  idle: { text: "等待中", cls: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400" },
  running: { text: "处理中", cls: "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300" },
  done: { text: "完成", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300" },
  error: { text: "失败", cls: "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300" },
  cancelled: { text: "已取消", cls: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300" },
};

function getMediaKind(item: BatchItem): "video" | "audio" | "image" {
  const mime = (item.result?.mime || item.file.type || "").toLowerCase();
  const name = item.file.name.toLowerCase();
  if (mime.startsWith("video/") || /\.(mp4|webm|mov|mkv|avi|flv|ts|m4v|3gp|wmv)$/i.test(name)) return "video";
  if (mime.startsWith("audio/") || /\.(mp3|wav|flac|aac|ogg|m4a|opus|wma)$/i.test(name)) return "audio";
  return "image";
}

export default function BatchResults({ items, running, onError }: Props) {
  const [zipping, setZipping] = useState(false);
  const [previewItem, setPreviewItem] = useState<BatchItem | null>(null);

  // 监听 ESC 键关闭预览弹窗
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreviewItem(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (items.length === 0) return null;

  const finished = items.filter((i) => i.status === "done" || i.status === "error" || i.status === "cancelled").length;
  const doneItems = items.filter((i) => i.status === "done" && i.result);
  const failed = items.filter((i) => i.status === "error").length;
  const runningItem = items.find((i) => i.status === "running");
  const overall = items.length
    ? Math.min(1, (finished + (runningItem?.progress ?? 0)) / items.length)
    : 0;
  const started = items.some((i) => i.status !== "idle");

  const inTotal = doneItems.reduce((s, i) => s + i.file.size, 0);
  const outTotal = doneItems.reduce((s, i) => s + (i.result?.size ?? 0), 0);
  const savedPct = inTotal > 0 ? Math.round((1 - outTotal / inTotal) * 100) : 0;

  async function downloadAll() {
    if (zipping || doneItems.length === 0) return;
    setZipping(true);
    try {
      const entries = await Promise.all(
        doneItems.map(async (i) => {
          const r = i.result!;
          const blob = await fetch(r.url).then((res) => res.blob());
          return { name: r.name, blob };
        })
      );
      const zip = await zipFiles(entries);
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      downloadBlob(zip, `batch-${stamp}-${doneItems.length}.zip`);
    } catch (e) {
      onError(`打包失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setZipping(false);
    }
  }

  // 唯一单项完成时的媒体类型
  const singleDone = doneItems.length === 1 ? doneItems[0] : null;
  const singleKind = singleDone ? getMediaKind(singleDone) : null;

  return (
    <div className="mt-8 space-y-4">
      {/* 总体处理进度条 */}
      {started && (
        <div>
          <div className="mb-1.5 flex justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>
              {running
                ? `正在处理第 ${Math.min(finished + 1, items.length)} / ${items.length} 个文件…`
                : `已完成 ${finished} / ${items.length} 个文件`}
            </span>
            <span className="tabular-nums">{Math.round(overall * 100)}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div
              className="h-full rounded-full bg-blue-600 transition-all duration-300"
              style={{ width: `${overall * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* 汇总结果条 */}
      {doneItems.length > 0 && (
        <div className="animate-pop-in flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50/50 px-4 py-3 dark:border-emerald-800/60 dark:bg-emerald-950/20">
          <div className="flex flex-wrap gap-3 text-sm text-slate-700 dark:text-slate-200">
            <span>
              成功 <b className="text-emerald-700 dark:text-emerald-400">{doneItems.length}</b> 个
            </span>
            {failed > 0 && (
              <span>
                失败 <b className="text-rose-600 dark:text-rose-400">{failed}</b> 个
              </span>
            )}
            <span className="tabular-nums">
              {formatBytes(inTotal)} → {formatBytes(outTotal)}
              <span className={`ml-1 font-medium ${savedPct >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`}>
                （{savedPct >= 0 ? `节省 ${savedPct}%` : `增大 ${-savedPct}%`}）
              </span>
            </span>
          </div>
          <button
            type="button"
            onClick={downloadAll}
            disabled={zipping || running}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-emerald-200 transition-all hover:bg-emerald-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-emerald-600 dark:shadow-none dark:hover:bg-emerald-500"
          >
            {zipping ? "⏳ 打包中…" : `📦 打包下载 ZIP（${doneItems.length}）`}
          </button>
        </div>
      )}

      {/* 单文件完成时就地内联预览（重点解决单个视频压缩后无法播放/预览的体验断点） */}
      {singleDone && singleDone.result && (
        <div className="animate-pop-in overflow-hidden rounded-2xl border border-slate-200 bg-slate-900 p-3 shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <div className="mb-2 flex items-center justify-between px-2 text-xs text-slate-300">
            <span className="flex items-center gap-1.5 font-medium">
              <span>{singleKind === "video" ? "🎬 视频预览" : singleKind === "audio" ? "🎵 音频预览" : "🖼️ 图片预览"}</span>
              <span className="text-slate-400">({singleDone.result.name})</span>
            </span>
            <span className="text-emerald-400">可直接在线播放核验画质</span>
          </div>
          <div className="flex items-center justify-center rounded-xl bg-black p-2">
            {singleKind === "video" && (
              <video
                key={singleDone.result.url}
                src={singleDone.result.url}
                controls
                playsInline
                preload="auto"
                className="max-h-[380px] w-full rounded-lg"
              />
            )}
            {singleKind === "audio" && (
              <audio key={singleDone.result.url} src={singleDone.result.url} controls className="w-full" />
            )}
            {singleKind === "image" && (
              <img
                src={singleDone.result.url}
                alt={singleDone.result.name}
                className="max-h-[380px] max-w-full rounded-lg object-contain"
              />
            )}
          </div>
        </div>
      )}

      {/* 列表条目 */}
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-900">
        {items.map((it, idx) => {
          const st = STATUS_STYLE[it.status];
          const r = it.result;
          const kind = getMediaKind(it);

          return (
            <li key={it.id} className="flex items-center gap-3 px-3 py-2.5">
              <span className="tabular-nums w-6 shrink-0 text-center text-xs text-slate-400 dark:text-slate-500">{idx + 1}</span>

              {/* 缩略图区域：根据媒体类型安全渲染，彻底解决视频 URL 被 img 标签渲染为裂图的问题 */}
              <div
                role={r ? "button" : undefined}
                tabIndex={r ? 0 : undefined}
                onClick={() => r && setPreviewItem(it)}
                title={r ? "点击播放 / 预览" : undefined}
                className={`relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800 ${
                  r ? "cursor-pointer ring-1 ring-slate-200 transition hover:ring-2 hover:ring-blue-500 dark:ring-slate-700" : ""
                }`}
              >
                {kind === "video" ? (
                  <div className="relative flex h-full w-full items-center justify-center bg-slate-900 text-white">
                    {r ? (
                      <video src={r.url} preload="metadata" className="h-full w-full object-cover opacity-75" />
                    ) : (
                      <span className="text-base">🎬</span>
                    )}
                    {r && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/30 transition hover:bg-black/10">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-xs font-bold text-slate-900 shadow-sm">
                          ▶
                        </span>
                      </div>
                    )}
                  </div>
                ) : kind === "audio" ? (
                  <div className="flex h-full w-full items-center justify-center bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-300">
                    <span className="text-xl">🎵</span>
                  </div>
                ) : r ? (
                  <img src={r.url} alt={r.name} className="h-full w-full object-cover" />
                ) : (
                  <span className="text-lg">🖼️</span>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-200" title={it.file.name}>
                  {it.file.name}
                </p>
                <p className="tabular-nums text-xs text-slate-500 dark:text-slate-400">
                  {r ? (
                    <>
                      {formatBytes(it.file.size)} → <span className="font-medium text-slate-700 dark:text-slate-300">{formatBytes(r.size)}</span>
                      {it.file.size > 0 && (
                        <span className="ml-1 text-slate-400 dark:text-slate-500">
                          ({Math.round((r.size / it.file.size) * 100)}%)
                        </span>
                      )}
                    </>
                  ) : (
                    formatBytes(it.file.size)
                  )}
                </p>
                {it.status === "running" && (
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className="h-full bg-blue-600 transition-all duration-300"
                      style={{ width: `${Math.round(it.progress * 100)}%` }}
                    />
                  </div>
                )}
                {it.status === "error" && it.error && (
                  <details className="mt-1 text-xs text-rose-600 dark:text-rose-400">
                    <summary className="cursor-pointer">查看错误原因</summary>
                    <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all text-[11px]">
                      {it.error}
                    </pre>
                  </details>
                )}
              </div>

              <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ${st.cls}`}>
                {it.status === "running" ? `处理中 ${Math.round(it.progress * 100)}%` : st.text}
              </span>

              {r && (
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPreviewItem(it)}
                    className="rounded-md bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 transition hover:bg-blue-100 active:scale-95 dark:bg-blue-950/80 dark:text-blue-300 dark:hover:bg-blue-900"
                  >
                    {kind === "video" ? "▶ 播放" : kind === "audio" ? "▶ 试听" : "🔍 预览"}
                  </button>
                  <a
                    href={r.url}
                    download={r.name}
                    className="rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 active:scale-95 dark:bg-emerald-950/80 dark:text-emerald-300 dark:hover:bg-emerald-900"
                  >
                    下载
                  </a>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {/* 点击弹出的完整大屏预览/播放模态框 */}
      {previewItem && previewItem.result && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-fade-in"
          onClick={() => setPreviewItem(null)}
        >
          <div
            className="relative flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl bg-white shadow-2xl dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 模态框顶部 */}
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 dark:border-slate-800">
              <div className="min-w-0 pr-4">
                <h4 className="truncate text-base font-bold text-slate-900 dark:text-white">
                  {previewItem.result.name}
                </h4>
                <p className="tabular-nums text-xs text-slate-500 dark:text-slate-400">
                  原大小 {formatBytes(previewItem.file.size)} → 压缩后 {formatBytes(previewItem.result.size)}
                  {previewItem.file.size > 0 && (
                    <span className="ml-1 text-emerald-600 dark:text-emerald-400">
                      （节省 {Math.round((1 - previewItem.result.size / previewItem.file.size) * 100)}%）
                    </span>
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewItem(null)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                ✕
              </button>
            </div>

            {/* 播放/展示区域 */}
            <div className="flex flex-1 items-center justify-center overflow-auto bg-slate-950 p-4">
              {getMediaKind(previewItem) === "video" && (
                <video
                  key={previewItem.result.url}
                  src={previewItem.result.url}
                  controls
                  autoPlay
                  playsInline
                  className="max-h-[65vh] w-full rounded-xl bg-black"
                />
              )}
              {getMediaKind(previewItem) === "audio" && (
                <audio
                  key={previewItem.result.url}
                  src={previewItem.result.url}
                  controls
                  autoPlay
                  className="w-full max-w-lg"
                />
              )}
              {getMediaKind(previewItem) === "image" && (
                <img
                  src={previewItem.result.url}
                  alt={previewItem.result.name}
                  className="max-h-[68vh] max-w-full rounded-xl object-contain shadow-2xl"
                />
              )}
            </div>

            {/* 模态框底部按钮 */}
            <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-5 py-3 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setPreviewItem(null)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                关闭
              </button>
              <a
                href={previewItem.result.url}
                download={previewItem.result.name}
                className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700 active:scale-95"
              >
                ⬇️ 下载文件
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
