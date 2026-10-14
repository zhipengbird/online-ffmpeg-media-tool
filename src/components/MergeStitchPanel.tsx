import { useRef, useState } from "react";
import { formatBytes } from "../utils/format";

export interface MergeItem {
  id: string;
  file: File;
  previewUrl: string;
}

interface Props {
  items: MergeItem[];
  disabled: boolean;
  onAdd: (files: File[]) => void;
  onRemove: (id: string) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onClear: () => void;
}

export default function MergeStitchPanel({ items, disabled, onAdd, onRemove, onMove, onClear }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const totalSize = items.reduce((sum, it) => sum + it.file.size, 0);

  const pick = () => {
    if (!disabled) inputRef.current?.click();
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">待拼接图片素材（支持 2 ~ 30 张）</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">将按列表顺序从上到下（或从左到右）依次拼接，可自由调整顺序</p>
        </div>
        {items.length > 0 && (
          <div className="flex items-center gap-3">
            <span className="tabular-nums text-xs text-slate-500 dark:text-slate-400">
              已选 {items.length} 张 · {formatBytes(totalSize)}
            </span>
            <button
              type="button"
              onClick={onClear}
              disabled={disabled}
              className="rounded-md px-2 py-1 text-xs font-medium text-rose-600 transition hover:bg-rose-50 active:scale-95 disabled:opacity-50 dark:text-rose-400 dark:hover:bg-rose-950/60"
            >
              清空
            </button>
          </div>
        )}
      </div>

      {/* 拖拽/点击上传区域 */}
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
          items.length > 0 ? "py-4" : "min-h-[160px] py-6"
        } ${
          dragging
            ? "border-blue-600 bg-blue-50/70 dark:border-blue-500 dark:bg-blue-950/40"
            : "border-slate-300 bg-slate-50/80 hover:border-blue-500 hover:bg-slate-100/60 dark:border-slate-700 dark:bg-slate-800/40 dark:hover:border-blue-400 dark:hover:bg-slate-800/80"
        } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-lg shadow-sm ring-1 ring-slate-200 transition dark:bg-slate-800 dark:ring-slate-700">
          🧩
        </div>
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
          {items.length > 0 ? "➕ 继续添加图片（按住 Shift / Ctrl 可多选）" : "点击选择多张图片，或将图片拖拽到此处"}
        </p>
        <p className="text-xs text-slate-400 dark:text-slate-500">支持 JPG、PNG、WebP、BMP、TIFF 等主流图片格式</p>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*,.png,.jpg,.jpeg,.webp,.bmp,.gif,.tif,.tiff"
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onAdd(files);
          e.target.value = "";
        }}
      />

      {/* 提示信息 */}
      {items.length === 1 && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-amber-700 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-300">
          ⚠️ 当前已选 1 张图片，拼接至少需要 2 张图片，请继续点击上方添加更多图片。
        </div>
      )}

      {/* 图片列表及排序卡片 */}
      {items.length > 0 && (
        <div className="mt-4">
          <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-sm dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-900">
            {items.map((it, idx) => (
              <li key={it.id} className="flex items-center gap-3 px-3 py-2.5 transition hover:bg-slate-50/80 dark:hover:bg-slate-800/50">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-blue-50 text-xs font-bold text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                  #{idx + 1}
                </span>

                <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800">
                  <img src={it.previewUrl} alt={it.file.name} className="h-full w-full object-cover" />
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-slate-800 dark:text-slate-200" title={it.file.name}>
                    {it.file.name}
                  </p>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500">{formatBytes(it.file.size)}</p>
                </div>

                {/* 排序与删除按钮 */}
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    title="上移"
                    disabled={disabled || idx === 0}
                    onClick={() => onMove(idx, -1)}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 dark:text-slate-400 dark:hover:bg-slate-800"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    title="下移"
                    disabled={disabled || idx === items.length - 1}
                    onClick={() => onMove(idx, 1)}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 dark:text-slate-400 dark:hover:bg-slate-800"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    title="删除"
                    disabled={disabled}
                    onClick={() => onRemove(it.id)}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-rose-500 transition hover:bg-rose-50 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 dark:text-rose-400 dark:hover:bg-rose-950/60"
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
