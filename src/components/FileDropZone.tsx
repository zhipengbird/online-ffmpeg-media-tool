import { useRef, useState, type ReactNode } from "react";
import type { MediaInfo } from "../lib/ffmpeg";
import { formatBytes, formatTime } from "../utils/format";

interface Props {
  label: string;
  accept: string;
  file: File | null;
  info: MediaInfo | null;
  probing: boolean;
  onFile: (file: File | null) => void;
}

function Chip({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`rounded-md bg-white px-2 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200 transition dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700 ${className}`}
    >
      {children}
    </span>
  );
}

export default function FileDropZone({ label, accept, file, info, probing, onFile }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const picker = (
    <input
      ref={inputRef}
      type="file"
      accept={accept}
      className="hidden"
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) onFile(f);
        e.target.value = "";
      }}
    />
  );

  const dropHandlers = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(true);
    },
    onDragLeave: () => setDragging(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer.files?.[0];
      if (f) onFile(f);
    },
  };

  if (!file) {
    return (
      <div>
        <p className="mb-1.5 text-sm font-medium text-slate-700 dark:text-slate-300">{label}</p>
        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
          }}
          {...dropHandlers}
          className={`flex min-h-[160px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-all duration-200 active:scale-[0.99] ${
            dragging
              ? "border-blue-600 bg-blue-50/70 dark:border-blue-500 dark:bg-blue-950/40"
              : "border-slate-300 bg-slate-50/80 hover:border-blue-500 hover:bg-slate-100/60 dark:border-slate-700 dark:bg-slate-800/40 dark:hover:border-blue-400 dark:hover:bg-slate-800/80"
          }`}
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-2xl shadow-sm ring-1 ring-slate-200 transition dark:bg-slate-800 dark:ring-slate-700">
            ⬆️
          </div>
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
            点击选择文件，或将文件拖拽到此处
          </p>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            文件只在本地浏览器中处理，不会上传到服务器
          </p>
        </div>
        {picker}
      </div>
    );
  }

  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-slate-700 dark:text-slate-300">{label}</p>
      <div
        {...dropHandlers}
        className={`min-h-[160px] rounded-xl border p-4 shadow-sm transition ${
          dragging
            ? "border-blue-500 bg-blue-50/50 ring-2 ring-blue-500/20 dark:border-blue-400 dark:bg-blue-950/30 dark:ring-blue-500/30"
            : "border-slate-200/90 bg-white dark:border-slate-700/80 dark:bg-slate-800/60"
        }`}
      >
        {dragging && (
          <div className="mb-3 flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">
            📥 松开鼠标替换当前文件
          </div>
        )}
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-lg text-white shadow-sm ring-1 ring-slate-800/10 dark:bg-blue-600 dark:ring-0">
            📄
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100" title={file.name}>
              {file.name}
            </p>
            <p className="tabular-nums text-xs text-slate-500 dark:text-slate-400">{formatBytes(file.size)}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="rounded-md px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-100 active:scale-95 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              更换
            </button>
            <button
              type="button"
              onClick={() => onFile(null)}
              className="rounded-md px-2.5 py-1 text-xs font-medium text-rose-600 transition hover:bg-rose-50 active:scale-95 dark:text-rose-400 dark:hover:bg-rose-950/60"
            >
              移除
            </button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-1.5">
          {probing && (
            <Chip className="animate-shimmer bg-gradient-to-r from-slate-100 via-slate-200/70 to-slate-100 dark:from-slate-800 dark:via-slate-700 dark:to-slate-800">
              ⏳ 正在读取媒体信息…
            </Chip>
          )}
          {!probing && info && (
            <>
              {info.duration > 0 && <Chip>⏱ 时长 {formatTime(info.duration)}</Chip>}
              {info.width > 0 && info.height > 0 && (
                <Chip>
                  📐 {info.width}×{info.height}
                </Chip>
              )}
              <Chip>{info.hasVideo ? "🎞 含画面" : "🚫 无画面"}</Chip>
              <Chip>{info.hasAudio ? "🎵 含音轨" : "🔇 无音轨"}</Chip>
            </>
          )}
        </div>
      </div>
      {picker}
    </div>
  );
}
