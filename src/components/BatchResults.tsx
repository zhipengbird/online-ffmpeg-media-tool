import { useState } from "react";
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

export default function BatchResults({ items, running, onError }: Props) {
  const [zipping, setZipping] = useState(false);

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

  return (
    <div className="mt-8 space-y-4">
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

      <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-900">
        {items.map((it, idx) => {
          const st = STATUS_STYLE[it.status];
          const r = it.result;
          return (
            <li key={it.id} className="flex items-center gap-3 px-3 py-2.5">
              <span className="tabular-nums w-6 shrink-0 text-center text-xs text-slate-400 dark:text-slate-500">{idx + 1}</span>
              <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
                {r ? (
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
                <a
                  href={r.url}
                  download={r.name}
                  className="shrink-0 rounded-md px-2.5 py-1 text-xs font-medium text-emerald-700 transition hover:bg-emerald-50 active:scale-95 dark:text-emerald-400 dark:hover:bg-emerald-950/60"
                >
                  下载
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
