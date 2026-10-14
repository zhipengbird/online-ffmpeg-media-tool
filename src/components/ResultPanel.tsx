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
  const kind = result.mime.split("/")[0];
  const ratio = result.inputSize > 0 ? Math.round((result.size / result.inputSize) * 100) : 0;
  const smaller = result.size < result.inputSize;

  return (
    <div className="animate-pop-in mt-8 overflow-hidden rounded-2xl border border-emerald-200 bg-emerald-50/40 shadow-sm dark:border-emerald-800/60 dark:bg-emerald-950/20">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-emerald-100 bg-white/80 px-5 py-3 dark:border-emerald-900/60 dark:bg-slate-900/80">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500 text-sm text-white shadow-sm">
            ✓
          </span>
          <h3 className="font-semibold text-slate-800 dark:text-slate-100">处理完成</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span className="tabular-nums rounded-md bg-white px-2 py-1 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700">
            原始 {formatBytes(result.inputSize)}
          </span>
          <span>→</span>
          <span
            className={`tabular-nums rounded-md px-2 py-1 font-medium ring-1 ${
              smaller
                ? "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:ring-emerald-800"
                : "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:ring-amber-800"
            }`}
          >
            输出 {formatBytes(result.size)}（{ratio}%）
          </span>
          {elapsed != null && elapsed > 0 && (
            <span className="tabular-nums rounded-md bg-slate-100 px-2 py-1 text-slate-600 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700">
              ⏱ 耗时 {elapsed}s
            </span>
          )}
        </div>
      </div>

      <div className="space-y-5 p-5">
        <div className="flex items-center justify-center rounded-xl bg-slate-950 p-3 ring-1 ring-slate-800">
          {kind === "video" && (
            <video key={result.url} src={result.url} controls className="max-h-[420px] w-full rounded-lg" />
          )}
          {kind === "audio" && <audio key={result.url} src={result.url} controls className="w-full" />}
          {kind === "image" && (
            <img src={result.url} alt="输出结果" className="max-h-[420px] max-w-full rounded-lg object-contain" />
          )}
        </div>

        <div className="flex flex-wrap gap-3">
          <a
            href={result.url}
            download={result.name}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-emerald-200 transition-all hover:bg-emerald-700 active:scale-[0.98] dark:bg-emerald-600 dark:shadow-none dark:hover:bg-emerald-500"
          >
            ⬇️ 下载 {result.name}
          </a>
        </div>

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
  );
}
