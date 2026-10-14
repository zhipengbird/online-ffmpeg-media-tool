import { useRef, useState } from "react";
import type { BatchItem } from "../lib/batch";
import { formatBytes } from "../utils/format";

interface Props {
  accept: string;
  items: BatchItem[];
  disabled: boolean;
  onAdd: (files: File[]) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
}

export default function BatchDropZone({ accept, items, disabled, onAdd, onRemove, onClear }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const totalSize = items.reduce((sum, it) => sum + it.file.size, 0);

  const typeLabel = accept.includes("video")
    ? "视频文件"
    : accept.includes("audio")
      ? "音频文件"
      : "图片文件";
  const unitWord = accept.includes("video") || accept.includes("audio") ? "个文件" : "张图片";

  const pick = () => {
    if (!disabled) inputRef.current?.click();
  };

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{typeLabel}（支持多选批量处理）</p>
        {items.length > 0 && (
          <span className="tabular-nums text-xs text-slate-500 dark:text-slate-400">
            共 {items.length} 个 · {formatBytes(totalSize)}
          </span>
        )}
      </div>

      <div
        role="button"
        tabIndex={0}
        aria-disabled={disabled}
        onClick={pick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") pick();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (disabled) return;
          const files = Array.from(e.dataTransfer.files ?? []);
          if (files.length) onAdd(files);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 text-center transition-all duration-200 active:scale-[0.99] ${
          items.length > 0 ? "py-5" : "min-h-[160px] py-6"
        } ${
          dragging
            ? "border-blue-600 bg-blue-50/70 dark:border-blue-500 dark:bg-blue-950/40"
            : "border-slate-300 bg-slate-50/80 hover:border-blue-500 hover:bg-slate-100/60 dark:border-slate-700 dark:bg-slate-800/40 dark:hover:border-blue-400 dark:hover:bg-slate-800/80"
        } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-xl shadow-sm ring-1 ring-slate-200 transition dark:bg-slate-800 dark:ring-slate-700">
          ➕
        </div>
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
          {items.length > 0 ? `继续添加${typeLabel.slice(0, 2)}` : `点击选择多${unitWord}，或将文件拖拽到此处`}
        </p>
        <p className="text-xs text-slate-400 dark:text-slate-500">按添加顺序依次在本地处理；文件不离开用户设备</p>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onAdd(files);
          e.target.value = "";
        }}
      />

      {items.length > 0 && (
        <div className="mt-3">
          <div className="mb-2 flex justify-end">
            <button
              type="button"
              onClick={onClear}
              disabled={disabled}
              className="rounded-md px-2.5 py-1 text-xs font-medium text-rose-600 transition hover:bg-rose-50 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 dark:text-rose-400 dark:hover:bg-rose-950/60"
            >
              清空列表
            </button>
          </div>
          <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-900">
            {items.map((it, idx) => (
              <li key={it.id} className="flex items-center gap-3 px-3 py-2.5">
                <span className="tabular-nums w-6 shrink-0 text-center text-xs text-slate-400 dark:text-slate-500">{idx + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-200" title={it.file.name}>
                    {it.file.name}
                  </p>
                  <p className="tabular-nums text-xs text-slate-500 dark:text-slate-400">
                    {formatBytes(it.file.size)}
                    {it.info && it.info.width > 0 && ` · ${it.info.width}×${it.info.height}`}
                    {it.probing && " · 读取信息中…"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onRemove(it.id)}
                  disabled={disabled}
                  className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-rose-600 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-rose-400"
                >
                  移除
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
