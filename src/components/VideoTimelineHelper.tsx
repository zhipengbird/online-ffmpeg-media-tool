import { useEffect, useRef, useState } from "react";
import type { MediaInfo } from "../lib/ffmpeg";

interface Props {
  file: File | null;
  info: MediaInfo | null;
  start: number;
  end: number;
  onChangeStart: (v: number) => void;
  onChangeEnd: (v: number) => void;
}

export default function VideoTimelineHelper({
  file,
  info,
  start,
  end,
  onChangeStart,
  onChangeEnd,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    if (!file) {
      setVideoUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setVideoUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [file]);

  const totalDuration = duration || (info?.duration ?? 0);

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration || 0);
    }
  };

  const trackRef = useRef<HTMLDivElement>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);

  const seekTo = (t: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = Math.max(0, Math.min(t, totalDuration));
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsScrubbing(true);
    updatePosition(e.clientX);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isScrubbing) {
      updatePosition(e.clientX);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setIsScrubbing(false);
  };

  const updatePosition = (clientX: number) => {
    if (!trackRef.current || totalDuration <= 0) return;
    const rect = trackRef.current.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    seekTo(pos * totalDuration);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      seekTo(currentTime - (e.shiftKey ? 1 : 0.1));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      seekTo(currentTime + (e.shiftKey ? 1 : 0.1));
    }
  };

  if (!file || !videoUrl) return null;

  const effectiveEnd = end > 0 ? Math.min(end, totalDuration || end) : totalDuration;
  const clipLength = Math.max(0, effectiveEnd - start);

  const startPercent = totalDuration > 0 ? (Math.min(start, totalDuration) / totalDuration) * 100 : 0;
  const endPercent = totalDuration > 0 ? (effectiveEnd / totalDuration) * 100 : 100;
  const currentPercent = totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0;

  return (
    <div className="mt-6 overflow-hidden rounded-2xl border border-blue-100 bg-gradient-to-b from-blue-50/60 to-white p-4 shadow-sm dark:border-blue-900/40 dark:from-blue-950/20 dark:to-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-blue-100/80 pb-3 dark:border-blue-900/40">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-xs text-white">
            🎬
          </span>
          <div>
            <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              视频剪辑预览 & 时间打点
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              播放或拖动进度条，实时抓取时间戳，无需手动计算秒数
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs font-mono">
          <span className="rounded-md bg-blue-100/80 px-2 py-0.5 text-blue-700 dark:bg-blue-950/80 dark:text-blue-300">
            当前: {currentTime.toFixed(2)}s
          </span>
          <span className="text-slate-400">/</span>
          <span className="text-slate-600 dark:text-slate-400">
            总长: {totalDuration > 0 ? `${totalDuration.toFixed(2)}s` : "--"}
          </span>
        </div>
      </div>

      <div className="mt-3 grid gap-4 md:grid-cols-[1.2fr_1fr]">
        {/* 视频播放器 */}
        <div className="relative aspect-video overflow-hidden rounded-xl bg-black">
          <video
            ref={videoRef}
            src={videoUrl}
            controls
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            className="h-full w-full object-contain"
            playsInline
          />
        </div>

        {/* 控制与打卡区 */}
        <div className="flex flex-col justify-between gap-3">
          {/* 可视化区间指示条 */}
          <div className="rounded-xl border border-slate-200/80 bg-white/80 p-3 dark:border-slate-800 dark:bg-slate-900/80">
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="font-medium text-slate-700 dark:text-slate-300">截取区间可视化</span>
              <span className="font-semibold text-blue-600 dark:text-blue-400">
                {clipLength > 0 ? `截取时长: ${clipLength.toFixed(2)}s` : "截取到末尾"}
              </span>
            </div>

            {/* 自定义进度指示 */}
            <div
              ref={trackRef}
              role="slider"
              tabIndex={0}
              aria-label="视频时间轴定位"
              aria-valuemin={0}
              aria-valuemax={totalDuration}
              aria-valuenow={currentTime}
              aria-valuetext={`${currentTime.toFixed(2)} 秒`}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onKeyDown={handleKeyDown}
              className={`relative h-5 w-full cursor-pointer touch-none select-none overflow-hidden rounded-md bg-slate-200 outline-none transition-shadow focus:ring-2 focus:ring-blue-500 dark:bg-slate-800 ${
                isScrubbing ? "ring-2 ring-blue-400" : ""
              }`}
              title="点击或长按拖拽跳转，支持方向键微调"
            >
              {/* 高亮选中截取区间 */}
              <div
                className="absolute top-0 bottom-0 bg-blue-500/40 border-x-2 border-blue-600 transition-all dark:bg-blue-500/30"
                style={{
                  left: `${startPercent}%`,
                  width: `${Math.max(1, endPercent - startPercent)}%`,
                }}
              />
              {/* 当前播放光标 */}
              <div
                className="absolute top-0 bottom-0 w-1.5 bg-rose-500 shadow-md transition-all"
                style={{ left: `calc(${currentPercent}% - 3px)` }}
              />
            </div>

            <div className="mt-1 flex justify-between text-[10px] text-slate-400 font-mono">
              <span>0.0s</span>
              <span>{totalDuration > 0 ? `${totalDuration.toFixed(1)}s` : ""}</span>
            </div>
          </div>

          {/* 打点按钮操作区 */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onChangeStart(Number(currentTime.toFixed(2)))}
              className="group flex flex-col items-center justify-center rounded-xl border border-blue-200 bg-blue-50/70 p-2.5 text-blue-700 transition hover:bg-blue-100 hover:border-blue-300 active:scale-95 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-900/50"
            >
              <span className="text-xs font-bold flex items-center gap-1">
                📍 设为开始时间
              </span>
              <span className="mt-0.5 text-[11px] font-mono text-blue-600/80 dark:text-blue-400">
                当前: {currentTime.toFixed(2)}s
              </span>
            </button>

            <button
              type="button"
              onClick={() => onChangeEnd(Number(currentTime.toFixed(2)))}
              className="group flex flex-col items-center justify-center rounded-xl border border-indigo-200 bg-indigo-50/70 p-2.5 text-indigo-700 transition hover:bg-indigo-100 hover:border-indigo-300 active:scale-95 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:bg-indigo-900/50"
            >
              <span className="text-xs font-bold flex items-center gap-1">
                🏁 设为结束时间
              </span>
              <span className="mt-0.5 text-[11px] font-mono text-indigo-600/80 dark:text-indigo-400">
                当前: {currentTime.toFixed(2)}s
              </span>
            </button>
          </div>

          {/* 跳转导航快捷按钮 */}
          <div className="flex items-center justify-between gap-2 text-xs">
            <button
              type="button"
              onClick={() => seekTo(start)}
              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-slate-600 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              ⏮ 跳到开始点 ({start.toFixed(2)}s)
            </button>
            {end > 0 && (
              <button
                type="button"
                onClick={() => seekTo(end)}
                className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-slate-600 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                ⏭ 跳到结束点 ({end.toFixed(2)}s)
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
