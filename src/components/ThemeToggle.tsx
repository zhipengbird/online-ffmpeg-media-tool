import { type ThemeMode } from "../utils/theme";

interface Props {
  theme: ThemeMode;
  onChange: (mode: ThemeMode) => void;
}

export default function ThemeToggle({ theme, onChange }: Props) {
  const options: { mode: ThemeMode; label: string; icon: string }[] = [
    { mode: "light", label: "浅色", icon: "☀️" },
    { mode: "system", label: "跟随系统", icon: "💻" },
    { mode: "dark", label: "深色", icon: "🌙" },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="主题选择"
      className="inline-flex items-center rounded-xl bg-slate-100/90 p-1 ring-1 ring-slate-200/80 transition dark:bg-slate-800/90 dark:ring-slate-700/80"
    >
      {options.map((opt) => {
        const active = theme === opt.mode;
        return (
          <button
            key={opt.mode}
            type="button"
            role="radio"
            aria-checked={active}
            title={opt.label}
            onClick={() => onChange(opt.mode)}
            className={`relative flex items-center justify-center rounded-lg px-2.5 py-1 text-xs font-medium transition-all active:scale-95 ${
              active
                ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white"
                : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            <span className="text-sm leading-none">{opt.icon}</span>
            <span className="ml-1.5 hidden md:inline">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
