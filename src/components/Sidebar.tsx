import { CATEGORIES, TOOLS } from "../lib/tools";

interface Props {
  activeId: string;
  disabled: boolean;
  onSelect: (id: string) => void;
}

export default function Sidebar({ activeId, disabled, onSelect }: Props) {
  return (
    <nav className="space-y-5">
      {CATEGORIES.map((cat) => {
        const tools = TOOLS.filter((t) => t.category === cat.id);
        return (
          <div key={cat.id}>
            <p className="mb-2 flex items-center gap-2 px-2 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              <span>{cat.icon}</span>
              {cat.label}
            </p>
            <ul className="space-y-1">
              {tools.map((tool) => {
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
    </nav>
  );
}
