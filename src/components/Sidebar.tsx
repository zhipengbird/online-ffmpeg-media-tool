import { useMemo, useState } from "react";
import { CATEGORIES, TOOLS, type ToolDef } from "../lib/tools";

interface Props {
  activeId: string;
  disabled: boolean;
  onSelect: (id: string) => void;
}

const PINYIN_MAP: Record<string, string[]> = {
  "video-compress": ["sp", "ys", "shipin", "yasuo", "video", "compress"],
  "video-transcode": ["sp", "zm", "shipin", "zhuanma", "video", "transcode", "mp4", "mkv"],
  "video-edit": ["sp", "jj", "ts", "shipin", "jianji", "tiaosu", "cut", "edit"],
  "video-gif": ["sp", "dt", "shipin", "gif", "dongtu"],
  "video-frame": ["sp", "jt", "shipin", "jietu", "frame", "snapshot"],
  "video-watermark": ["sp", "sy", "shipin", "shuiyin", "watermark", "delogo"],
  "audio-studio": ["yp", "yy", "yinpin", "yinyue", "audio", "music", "mp3"],
  "image-studio": ["tp", "tupian", "image", "photo", "picture"],
  "id-photo": ["zjz", "zhengjianzhao", "idphoto", "photo", "1inch", "2inch"],
  "text-watermark": ["sy", "wz", "shuiyin", "wenzi", "text", "watermark"],
  "image-watermark": ["sy", "tpsy", "shuiyin", "watermark"],
  "image-stitch": ["pj", "ct", "pinjie", "changtu", "stitch", "merge", "long"],
};

function matchTool(tool: ToolDef, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (tool.name.toLowerCase().includes(q)) return true;
  if (tool.desc.toLowerCase().includes(q)) return true;
  if (tool.id.toLowerCase().includes(q)) return true;
  const pinyinKeys = PINYIN_MAP[tool.id] || [];
  return pinyinKeys.some((k) => k.includes(q));
}

export default function Sidebar({ activeId, disabled, onSelect }: Props) {
  const [query, setQuery] = useState("");

  const filteredTools = useMemo(() => {
    return TOOLS.filter((t) => matchTool(t, query));
  }, [query]);

  return (
    <div className="space-y-4">
      {/* 搜索框 */}
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
          🔍
        </span>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索工具 (支持拼音如 sp/sy)..."
          className="w-full rounded-xl border border-slate-200/90 bg-slate-50/70 py-1.5 pl-8 pr-7 text-xs text-slate-800 placeholder-slate-400 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-blue-500 dark:focus:ring-blue-900/40"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-[11px] text-slate-400 hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-slate-700"
            title="清空"
          >
            ✕
          </button>
        )}
      </div>

      <nav className="space-y-5">
        {CATEGORIES.map((cat) => {
          const catTools = filteredTools.filter((t) => t.category === cat.id);
          if (catTools.length === 0) return null;

          return (
            <div key={cat.id}>
              <p className="mb-2 flex items-center gap-2 px-2 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                <span>{cat.icon}</span>
                {cat.label}
              </p>
              <ul className="space-y-1">
                {catTools.map((tool) => {
                  const active = tool.id === activeId;
                  return (
                    <li key={tool.id}>
                      <button
                        type="button"
                        disabled={disabled && !active}
                        onClick={() => onSelect(tool.id)}
                        className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-all active:scale-[0.98] ${
                          active
                            ? "bg-slate-900 font-medium text-white shadow-sm dark:bg-blue-600 dark:shadow-none"
                            : "text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800/80 dark:hover:text-slate-200"
                        }`}
                      >
                        <span className="text-base leading-none">{tool.icon}</span>
                        <span className="truncate">{tool.name}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}

        {filteredTools.length === 0 && (
          <div className="py-6 text-center text-xs text-slate-400 dark:text-slate-500">
            未找到匹配 “{query}” 的工具
          </div>
        )}
      </nav>
    </div>
  );
}
