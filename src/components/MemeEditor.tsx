import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";

type LayerType = "text" | "image";

interface MemeLayer {
  id: string;
  type: LayerType;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  text: string;
  fontSize: number;
  color: string;
  strokeColor: string;
  strokeWidth: number;
  src?: string;
  file?: File;
}

interface Props {
  disabled: boolean;
  onExport: (file: File) => void;
  onError: (message: string) => void;
}

const IMAGE_ACCEPT = "image/*,.png,.jpg,.jpeg,.webp,.bmp,.gif,.tif,.tiff";
const makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));

export default function MemeEditor({ disabled, onExport, onError }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const baseInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const baseUrlRef = useRef<string | null>(null);
  const imageCacheRef = useRef(new Map<string, HTMLImageElement>());
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const [baseFile, setBaseFile] = useState<File | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [baseImage, setBaseImage] = useState<HTMLImageElement | null>(null);
  const [layers, setLayers] = useState<MemeLayer[]>([]);
  const layersRef = useRef<MemeLayer[]>(layers);
  layersRef.current = layers;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [format, setFormat] = useState<"jpg" | "png">("jpg");
  const [quality, setQuality] = useState(92);
  const [exporting, setExporting] = useState(false);

  const selected = layers.find((layer) => layer.id === selectedId) ?? null;

  useEffect(() => {
    return () => {
      if (baseUrlRef.current) URL.revokeObjectURL(baseUrlRef.current);
      for (const layer of layersRef.current) {
        if (layer.src) URL.revokeObjectURL(layer.src);
      }
    };
  }, []);

  useEffect(() => {
    if (!baseUrl) {
      setBaseImage(null);
      return;
    }
    const image = new Image();
    image.onload = () => setBaseImage(image);
    image.onerror = () => onError("无法读取这张图片，请换一个格式受支持的文件。");
    image.src = baseUrl;
  }, [baseUrl]);

  useEffect(() => {
    for (const layer of layers) {
      if (layer.type !== "image" || !layer.src || imageCacheRef.current.has(layer.id)) continue;
      const image = new Image();
      image.onload = () => {
        imageCacheRef.current.set(layer.id, image);
        drawPreview();
      };
      image.src = layer.src;
    }
    drawPreview();
  }, [baseImage, layers, selectedId]);

  function drawPreview(target = canvasRef.current, showSelection = true) {
    if (!target || !baseImage) return;
    const maxSide = 1200;
    const scale = Math.min(1, maxSide / Math.max(baseImage.naturalWidth, baseImage.naturalHeight));
    const width = Math.max(1, Math.round(baseImage.naturalWidth * scale));
    const height = Math.max(1, Math.round(baseImage.naturalHeight * scale));
    if (target.width !== width || target.height !== height) {
      target.width = width;
      target.height = height;
    }
    const ctx = target.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(baseImage, 0, 0, width, height);

    for (const layer of layers) {
      ctx.save();
      ctx.globalAlpha = clamp(layer.opacity);
      const x = layer.x * width;
      const y = layer.y * height;
      const layerWidth = layer.width * width;
      const layerHeight = layer.height * height;
      if (layer.type === "image") {
        const image = imageCacheRef.current.get(layer.id);
        if (image) ctx.drawImage(image, x, y, layerWidth, layerHeight);
      } else if (layer.text.trim()) {
        const fontSize = Math.max(16, layer.fontSize * Math.min(width, height));
        ctx.font = `900 ${fontSize}px Impact, Haettenschweiler, "Arial Black", sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineJoin = "round";
        ctx.fillStyle = layer.color;
        ctx.strokeStyle = layer.strokeColor;
        ctx.lineWidth = Math.max(0, fontSize * layer.strokeWidth);
        const lines = layer.text.split(/\r?\n/);
        const lineHeight = fontSize * 1.1;
        lines.forEach((line, index) => {
          const lineY = y + layerHeight / 2 + (index - (lines.length - 1) / 2) * lineHeight;
          ctx.strokeText(line, x + layerWidth / 2, lineY);
          ctx.fillText(line, x + layerWidth / 2, lineY);
        });
      }
      if (showSelection && layer.id === selectedId) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "#3b82f6";
        ctx.lineWidth = Math.max(2, width / 300);
        ctx.setLineDash([8, 6]);
        ctx.strokeRect(x, y, layerWidth, layerHeight);
      }
      ctx.restore();
    }
  }

  function handleBase(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/") && !/\.(png|jpe?g|webp|bmp|gif|tiff?)$/i.test(file.name)) {
      onError("请选择图片文件作为 Meme 底图。");
      return;
    }
    if (baseUrlRef.current) URL.revokeObjectURL(baseUrlRef.current);
    for (const layer of layers) if (layer.src) URL.revokeObjectURL(layer.src);
    const url = URL.createObjectURL(file);
    baseUrlRef.current = url;
    setBaseFile(file);
    setBaseUrl(url);
    setLayers([]);
    setSelectedId(null);
    onError("");
  }

  function addText() {
    if (!baseImage) return;
    const layer: MemeLayer = {
      id: makeId(),
      type: "text",
      x: 0.1,
      y: 0.08 + layers.filter((item) => item.type === "text").length * 0.12,
      width: 0.8,
      height: 0.14,
      opacity: 1,
      text: "输入文字",
      fontSize: 0.08,
      color: "#ffffff",
      strokeColor: "#000000",
      strokeWidth: 0.14,
    };
    setLayers((prev) => [...prev, layer]);
    setSelectedId(layer.id);
  }

  function addImage(file: File) {
    if (!baseImage) return;
    const src = URL.createObjectURL(file);
    const layer: MemeLayer = {
      id: makeId(),
      type: "image",
      x: 0.08,
      y: 0.08,
      width: 0.32,
      height: 0.32,
      opacity: 1,
      text: "",
      fontSize: 0.08,
      color: "#ffffff",
      strokeColor: "#000000",
      strokeWidth: 0.14,
      src,
      file,
    };
    setLayers((prev) => [...prev, layer]);
    setSelectedId(layer.id);
  }

  function updateSelected(patch: Partial<MemeLayer>) {
    if (!selectedId) return;
    setLayers((prev) => prev.map((layer) => (layer.id === selectedId ? { ...layer, ...patch } : layer)));
  }

  function removeSelected() {
    if (!selected) return;
    if (selected.src) URL.revokeObjectURL(selected.src);
    imageCacheRef.current.delete(selected.id);
    setLayers((prev) => prev.filter((layer) => layer.id !== selected.id));
    setSelectedId(null);
  }

  function hitTest(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i];
      if (x >= layer.x && x <= layer.x + layer.width && y >= layer.y && y <= layer.y + layer.height) {
        return { layer, x, y };
      }
    }
    return null;
  }

  function onPointerDown(event: PointerEvent<HTMLCanvasElement>) {
    const hit = hitTest(event);
    if (!hit) {
      setSelectedId(null);
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedId(hit.layer.id);
    dragRef.current = { id: hit.layer.id, dx: hit.x - hit.layer.x, dy: hit.y - hit.layer.y };
  }

  function onPointerMove(event: PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    const canvas = canvasRef.current;
    if (!drag || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    setLayers((prev) =>
      prev.map((layer) =>
        layer.id === drag.id
          ? { ...layer, x: clamp(x - drag.dx, 0, 1 - layer.width), y: clamp(y - drag.dy, 0, 1 - layer.height) }
          : layer,
      ),
    );
  }

  function onPointerUp(event: PointerEvent<HTMLCanvasElement>) {
    dragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  async function exportMeme() {
    if (!baseFile || !baseImage || exporting) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    setExporting(true);
    try {
      drawPreview(canvas, false);
      const mime = format === "png" ? "image/png" : "image/jpeg";
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("Meme 导出失败"))), mime, quality / 100);
      });
      onExport(new File([blob], `${baseFile.name.replace(/\.[^.]+$/, "")}-meme.${format}`, { type: mime }));
    } catch (error) {
      onError(error instanceof Error ? error.message : "Meme 导出失败");
    } finally {
      setExporting(false);
      drawPreview();
    }
  }

  return (
    <div className="mt-6 space-y-5">
      <input ref={baseInputRef} type="file" accept={IMAGE_ACCEPT} className="hidden" onChange={(event) => handleBase(event.target.files)} />
      <input
        ref={imageInputRef}
        type="file"
        accept={IMAGE_ACCEPT}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) addImage(file);
          event.target.value = "";
        }}
      />

      {!baseImage ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => baseInputRef.current?.click()}
          className="flex min-h-[220px] w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-blue-300 bg-blue-50/60 px-5 text-center transition hover:border-blue-500 hover:bg-blue-50 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 dark:border-blue-800 dark:bg-blue-950/20 dark:hover:border-blue-500"
        >
          <span className="text-4xl">🖼️</span>
          <span className="text-base font-semibold text-slate-800 dark:text-slate-100">先选择一张 Meme 底图</span>
          <span className="text-xs text-slate-500 dark:text-slate-400">上传后可以添加图片、文字，并直接拖动调整位置</span>
        </button>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{baseFile?.name}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">拖动蓝色框调整图层位置，点击图层列表切换编辑对象</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => baseInputRef.current?.click()} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">更换底图</button>
              <button type="button" onClick={() => imageInputRef.current?.click()} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700">＋ 添加图片</button>
              <button type="button" onClick={addText} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600">T 添加文字</button>
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="flex min-h-[320px] items-center justify-center overflow-hidden rounded-2xl bg-slate-950 p-3 ring-1 ring-slate-800">
              <canvas
                ref={canvasRef}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                className="max-h-[620px] max-w-full touch-none cursor-crosshair rounded-lg object-contain shadow-2xl"
              />
            </div>

            <aside className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/40">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">图层</p>
                {layers.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">还没有图层，点击上方按钮添加</p>
                ) : (
                  <div className="space-y-1.5">
                    {layers.map((layer, index) => (
                      <button
                        key={layer.id}
                        type="button"
                        onClick={() => setSelectedId(layer.id)}
                        className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition ${selectedId === layer.id ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"}`}
                      >
                        <span>{layer.type === "text" ? "T" : "🖼️"}</span>
                        <span className="min-w-0 flex-1 truncate">{layer.type === "text" ? layer.text || "文字图层" : `图片图层 ${index + 1}`}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {selected && (
                <div className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800">
                  {selected.type === "text" && (
                    <>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">文字内容<textarea value={selected.text} onChange={(event) => updateSelected({ text: event.target.value })} rows={2} className="mt-1 w-full resize-y rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-800 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" /></label>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="text-xs text-slate-600 dark:text-slate-300">文字颜色<input type="color" value={selected.color} onChange={(event) => updateSelected({ color: event.target.value })} className="mt-1 h-9 w-full rounded border border-slate-300 bg-white p-1 dark:border-slate-700 dark:bg-slate-900" /></label>
                        <label className="text-xs text-slate-600 dark:text-slate-300">描边颜色<input type="color" value={selected.strokeColor} onChange={(event) => updateSelected({ strokeColor: event.target.value })} className="mt-1 h-9 w-full rounded border border-slate-300 bg-white p-1 dark:border-slate-700 dark:bg-slate-900" /></label>
                      </div>
                      <label className="block text-xs text-slate-600 dark:text-slate-300">字号 <span className="float-right tabular-nums">{Math.round(selected.fontSize * 100)}%</span><input type="range" min="0.03" max="0.16" step="0.005" value={selected.fontSize} onChange={(event) => updateSelected({ fontSize: Number(event.target.value) })} className="mt-1 w-full" /></label>
                      <label className="block text-xs text-slate-600 dark:text-slate-300">描边强度 <span className="float-right tabular-nums">{Math.round(selected.strokeWidth * 100)}%</span><input type="range" min="0" max="0.3" step="0.01" value={selected.strokeWidth} onChange={(event) => updateSelected({ strokeWidth: Number(event.target.value) })} className="mt-1 w-full" /></label>
                    </>
                  )}
                  {selected.type === "image" && <label className="block text-xs text-slate-600 dark:text-slate-300">图片大小 <span className="float-right tabular-nums">{Math.round(selected.width * 100)}%</span><input type="range" min="0.08" max="0.9" step="0.01" value={selected.width} onChange={(event) => updateSelected({ width: Number(event.target.value), height: Number(event.target.value) })} className="mt-1 w-full" /></label>}
                  <label className="block text-xs text-slate-600 dark:text-slate-300">横向位置 <span className="float-right tabular-nums">{Math.round(selected.x * 100)}%</span><input type="range" min="0" max={1 - selected.width} step="0.01" value={selected.x} onChange={(event) => updateSelected({ x: Number(event.target.value) })} className="mt-1 w-full" /></label>
                  <label className="block text-xs text-slate-600 dark:text-slate-300">纵向位置 <span className="float-right tabular-nums">{Math.round(selected.y * 100)}%</span><input type="range" min="0" max={1 - selected.height} step="0.01" value={selected.y} onChange={(event) => updateSelected({ y: Number(event.target.value) })} className="mt-1 w-full" /></label>
                  <label className="block text-xs text-slate-600 dark:text-slate-300">透明度 <span className="float-right tabular-nums">{Math.round(selected.opacity * 100)}%</span><input type="range" min="0.1" max="1" step="0.05" value={selected.opacity} onChange={(event) => updateSelected({ opacity: Number(event.target.value) })} className="mt-1 w-full" /></label>
                  <button type="button" onClick={removeSelected} className="w-full rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:border-rose-900/60 dark:text-rose-400 dark:hover:bg-rose-950/30">删除当前图层</button>
                </div>
              )}
            </aside>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
            <div className="flex items-center gap-3 text-xs text-slate-600 dark:text-slate-300">
              <label>格式<select value={format} onChange={(event) => setFormat(event.target.value as "jpg" | "png")} className="ml-2 rounded-lg border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-900"><option value="jpg">JPG</option><option value="png">PNG</option></select></label>
              {format === "jpg" && <label>质量<input type="number" min="1" max="100" value={quality} onChange={(event) => setQuality(Math.max(1, Math.min(100, Number(event.target.value) || 1)))} className="ml-2 w-16 rounded-lg border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-900" /></label>}
            </div>
            <button type="button" onClick={() => void exportMeme()} disabled={disabled || exporting} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50">{exporting ? "⏳ 导出中…" : "⬇ 导出 Meme"}</button>
          </div>
        </>
      )}
    </div>
  );
}
