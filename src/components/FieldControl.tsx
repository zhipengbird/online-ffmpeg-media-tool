import type { Field, FieldValue } from "../lib/tools";

interface Props {
  field: Field;
  value: FieldValue;
  onChange: (v: FieldValue) => void;
}

const inputCls =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-blue-500/30";

export default function FieldControl({ field, value, onChange }: Props) {
  if (field.type === "checkbox") {
    return (
      <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/60 dark:hover:bg-slate-800">
        <input
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 accent-blue-600"
        />
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{field.label}</span>
      </label>
    );
  }

  const header = (
    <div className="mb-1.5 flex items-baseline justify-between gap-2">
      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{field.label}</span>
      {field.hint && <span className="text-right text-xs text-slate-400 dark:text-slate-500">{field.hint}</span>}
    </div>
  );

  if (field.type === "text") {
    return (
      <div>
        {header}
        <textarea
          rows={2}
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputCls} resize-y`}
        />
      </div>
    );
  }

  if (field.type === "color") {
    return (
      <div>
        {header}
        <div className="flex items-center gap-3">
          <input
            type="color"
            value={String(value)}
            onChange={(e) => onChange(e.target.value)}
            className="h-10 w-14 cursor-pointer rounded-md border border-slate-300 bg-white p-1 dark:border-slate-700 dark:bg-slate-800"
          />
          <span className="font-mono text-sm text-slate-600 dark:text-slate-300">{String(value).toUpperCase()}</span>
        </div>
      </div>
    );
  }

  if (field.type === "chips") {
    return (
      <div>
        {header}
        <div className="flex flex-wrap gap-2">
          {field.options?.map((o) => {
            const active = String(value) === o.value;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => onChange(o.value)}
                className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition active:scale-95 ${
                  active
                    ? "border-blue-600 bg-blue-600 text-white shadow-sm dark:border-blue-500 dark:bg-blue-600"
                    : "border-slate-300 bg-white text-slate-600 hover:border-slate-400 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:text-white"
                }`}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (field.type === "presets") {
    const list = field.presets ?? [];
    const hasCustom = list.some((p) => p.value === "custom");
    const cards: { value: string; label: string; hint?: string }[] = hasCustom
      ? list
      : [...list, { value: "custom", label: "自定义", hint: "手动设置下方各项参数" }];
    return (
      <div>
        <div className="mb-1.5 text-sm font-medium text-slate-700 dark:text-slate-300">{field.label}</div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {cards.map((c) => {
            const active = String(value) === c.value;
            return (
              <button
                key={c.value}
                type="button"
                onClick={() => onChange(c.value)}
                className={`rounded-xl border px-3 py-2.5 text-left transition active:scale-[0.98] ${
                  active
                    ? "border-blue-600 bg-blue-50/70 ring-2 ring-blue-500/20 dark:border-blue-500 dark:bg-blue-950/40 dark:ring-blue-500/30"
                    : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/60 dark:border-slate-700 dark:bg-slate-800/60 dark:hover:border-slate-600 dark:hover:bg-slate-800"
                }`}
              >
                <span className={`block text-sm font-semibold ${active ? "text-blue-700 dark:text-blue-300" : "text-slate-700 dark:text-slate-200"}`}>
                  {c.label}
                </span>
                {c.hint && <span className="mt-0.5 block text-xs leading-4 text-slate-400 dark:text-slate-500">{c.hint}</span>}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (field.type === "select") {
    return (
      <div>
        {header}
        <select
          className={inputCls}
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
        >
          {field.options?.map((o) => (
            <option key={o.value} value={o.value} className="dark:bg-slate-800 dark:text-slate-100">
              {o.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (field.type === "range") {
    return (
      <div>
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{field.label}</span>
          <span className="tabular-nums rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
            {Number(value)}
            {field.unit ?? ""}
          </span>
        </div>
        <input
          type="range"
          min={field.min}
          max={field.max}
          step={field.step ?? 1}
          value={Number(value)}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full accent-blue-600"
        />
        {field.hint && <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">{field.hint}</p>}
      </div>
    );
  }

  // number
  return (
    <div>
      {header}
      <div className="relative">
        <input
          type="number"
          min={field.min}
          max={field.max}
          step={field.step ?? 1}
          value={Number(value)}
          onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
          className={`${inputCls} ${field.unit ? "pr-12" : ""}`}
        />
        {field.unit && (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400 dark:text-slate-500">
            {field.unit}
          </span>
        )}
      </div>
    </div>
  );
}
