import { useEffect } from "react";
import Sidebar from "./Sidebar";
import { TOOLS } from "../lib/tools";

interface Props {
  open: boolean;
  onClose: () => void;
  activeId: string;
  disabled: boolean;
  onSelect: (id: string) => void;
}

export default function MobileDrawer({ open, onClose, activeId, disabled, onSelect }: Props) {
  // Lock body scroll when drawer is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") onClose();
      };
      window.addEventListener("keydown", handleKeyDown);
      return () => {
        document.body.style.overflow = "";
        window.removeEventListener("keydown", handleKeyDown);
      };
    }
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 lg:hidden" aria-modal="true" role="dialog">
      {/* Semi-transparent Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity duration-300"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Left-side Drawer Panel */}
      <div className="relative z-10 flex h-full w-[310px] max-w-[85vw] flex-col bg-white shadow-2xl ring-1 ring-slate-200 transition-transform duration-300 ease-out dark:bg-slate-900 dark:ring-slate-800">
        {/* Drawer Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3.5 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-sm text-white shadow-sm ring-1 ring-slate-800/10 dark:bg-blue-600 dark:ring-0">
              🎞️
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">工具箱目录</h3>
              <p className="text-[11px] text-slate-400 dark:text-slate-500">共 {TOOLS.length} 个本地媒体工具</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 active:scale-90 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
            title="关闭菜单"
          >
            ✕
          </button>
        </div>

        {/* Drawer Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 [scrollbar-width:thin] [padding-bottom:max(env(safe-area-inset-bottom),2rem)]">
          <Sidebar
            activeId={activeId}
            disabled={disabled}
            onSelect={(id) => {
              onSelect(id);
              onClose();
            }}
          />
        </div>
      </div>
    </div>
  );
}
