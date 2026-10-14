import { stem } from "../utils/format";

/**
 * 证件照处理（浏览器画布实现，不经过 FFmpeg）
 *
 * 流程：
 *  1. 解码图片并缩放到最长边 ≤ 1200px（加快抠图）
 *  2. 启发式抠图：从画面边缘估计背景色，对与之接近的连通区域做泛洪填充，视为背景
 *  3. 背景区域替换为白 / 蓝 / 红
 *  4. 按证件照规格的宽高比居中裁剪（可缩放、可上下平移），输出到标准像素尺寸（300dpi）
 *  5. 按需编码为 JPG（二分搜索质量以满足文件大小上限）或 PNG
 *
 * 局限：仅适用于背景颜色单一、与衣物有明显色差的照片。
 * 白衣 + 白背景等情况下抠图会不准确，此时应使用 AI 分割方案。
 */

export interface IdSpec {
  value: string;
  label: string;
  wMm: number;
  hMm: number;
}

export const ID_SPECS: IdSpec[] = [
  { value: "1inch", label: "一寸", wMm: 25, hMm: 35 },
  { value: "small1inch", label: "小一寸", wMm: 22, hMm: 32 },
  { value: "2inch", label: "二寸", wMm: 35, hMm: 49 },
  { value: "big1inch", label: "大一寸", wMm: 33, hMm: 48 },
  { value: "passport", label: "护照", wMm: 33, hMm: 48 },
  { value: "driver", label: "驾驶证", wMm: 21, hMm: 26 },
  { value: "socialsec", label: "社保卡", wMm: 26, hMm: 32 },
];

export const ID_BG: Record<string, { label: string; rgb: [number, number, number] }> = {
  white: { label: "白底", rgb: [255, 255, 255] },
  blue: { label: "蓝底", rgb: [67, 142, 219] },
  red: { label: "红底", rgb: [214, 35, 31] },
};

/** 输出分辨率（DPI），用于把毫米尺寸换算为像素 */
export const ID_DPI = 300;

export const mmToPx = (mm: number): number => Math.round((mm / 25.4) * ID_DPI);

export function specOf(value: string): IdSpec {
  return ID_SPECS.find((s) => s.value === value) ?? ID_SPECS[0];
}

export function specPx(spec: IdSpec): { w: number; h: number } {
  return { w: mmToPx(spec.wMm), h: mmToPx(spec.hMm) };
}

export interface IdPhotoOptions {
  spec: string;
  bg: string;
  /** 人像缩放 100 ~ 150（%） */
  zoom: number;
  /** 人物上下位置 -30 ~ 30（%），正数人物在画面中越靠下 */
  offsetY: number;
  format: "jpg" | "png";
  /** 文件大小上限（KB），0 表示不限制；仅对 JPG 生效 */
  maxKB: number;
}

const MAX_SIDE = 1200;
/** 背景颜色判定容差（RGB 欧氏距离） */
const BG_TOLERANCE = 42;

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("图片导出失败，可能是浏览器内存不足"))),
      type,
      quality
    );
  });
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

/**
 * 启发式背景检测，返回与像素一一对应的掩码（1 = 背景）。
 * 背景色取顶边及左右上半部边缘像素的中位数；
 * 只从这些边缘出发泛洪，不从底边出发，避免把底部的衣服误判为背景。
 */
export function findBackground(data: Uint8ClampedArray, w: number, h: number): Uint8Array {
  const sample: { r: number[]; g: number[]; b: number[] } = { r: [], g: [], b: [] };
  const pick = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    sample.r.push(data[i]);
    sample.g.push(data[i + 1]);
    sample.b.push(data[i + 2]);
  };
  const stepX = Math.max(1, Math.floor(w / 64));
  const stepY = Math.max(1, Math.floor(h / 64));
  for (let x = 0; x < w; x += stepX) pick(x, 0);
  for (let y = 0; y < h / 2; y += stepY) {
    pick(0, y);
    pick(w - 1, y);
  }
  const bgR = median(sample.r);
  const bgG = median(sample.g);
  const bgB = median(sample.b);
  const tol2 = BG_TOLERANCE * BG_TOLERANCE;

  const isBg = (p: number) => {
    const i = p * 4;
    const dr = data[i] - bgR;
    const dg = data[i + 1] - bgG;
    const db = data[i + 2] - bgB;
    return dr * dr + dg * dg + db * db <= tol2;
  };

  const mask = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  const push = (p: number) => {
    if (!mask[p] && isBg(p)) {
      mask[p] = 1;
      queue[tail++] = p;
    }
  };

  for (let x = 0; x < w; x++) push(x);
  for (let y = 0; y < h / 2; y++) {
    push(y * w);
    push(y * w + w - 1);
  }

  while (head < tail) {
    const p = queue[head++];
    const x = p % w;
    const y = (p - x) / w;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (y > 0) push(p - w);
    if (y < h - 1) push(p + w);
  }
  return mask;
}

/** 生成证件照文件（JPG 或 PNG），返回的 File 名称扩展名与格式一致 */
export async function makeIdPhoto(file: File, opts: IdPhotoOptions): Promise<File> {
  const spec = specOf(opts.spec);
  const bg = ID_BG[opts.bg] ?? ID_BG.white;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`无法解码「${file.name}」，证件照功能支持 JPG / PNG / WebP / BMP / GIF`);
  }

  // 1. 缩放到分析尺寸，并先铺白底，使透明区域也能被当作背景处理
  const k = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * k));
  const h = Math.max(1, Math.round(bitmap.height * k));
  const src = makeCanvas(w, h);
  const sctx = src.getContext("2d", { willReadFrequently: true });
  if (!sctx) throw new Error("浏览器不支持 Canvas 2D");
  sctx.fillStyle = "#ffffff";
  sctx.fillRect(0, 0, w, h);
  sctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  // 2~3. 抠图并换底
  const img = sctx.getImageData(0, 0, w, h);
  const mask = findBackground(img.data, w, h);
  const d = img.data;
  for (let p = 0; p < w * h; p++) {
    if (!mask[p]) continue;
    const i = p * 4;
    d[i] = bg.rgb[0];
    d[i + 1] = bg.rgb[1];
    d[i + 2] = bg.rgb[2];
    d[i + 3] = 255;
  }
  sctx.putImageData(img, 0, 0);

  // 4. 按规格比例居中取最大裁剪框，再按缩放与上下位置调整
  const ratio = spec.wMm / spec.hMm;
  let bw: number;
  let bh: number;
  if (w / h > ratio) {
    bh = h;
    bw = h * ratio;
  } else {
    bw = w;
    bh = w / ratio;
  }
  const zoom = Math.max(1, opts.zoom / 100);
  bw /= zoom;
  bh /= zoom;
  const cx = w / 2;
  const cy = h / 2 - (opts.offsetY / 100) * bh;
  const sx = Math.min(Math.max(0, cx - bw / 2), w - bw);
  const sy = Math.min(Math.max(0, cy - bh / 2), h - bh);

  const px = specPx(spec);
  const out = makeCanvas(px.w, px.h);
  const octx = out.getContext("2d");
  if (!octx) throw new Error("浏览器不支持 Canvas 2D");
  octx.fillStyle = `rgb(${bg.rgb.join(",")})`;
  octx.fillRect(0, 0, px.w, px.h);
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";
  octx.drawImage(src, sx, sy, bw, bh, 0, 0, px.w, px.h);

  // 5. 编码
  const isPng = opts.format === "png";
  const ext = isPng ? "png" : "jpg";
  const mime = isPng ? "image/png" : "image/jpeg";
  let blob: Blob;
  if (isPng) {
    blob = await canvasToBlob(out, mime);
  } else if (opts.maxKB > 0) {
    const limit = opts.maxKB * 1024;
    let lo = 0.3;
    let hi = 0.95;
    let best: Blob | null = null;
    for (let i = 0; i < 9; i++) {
      const q = (lo + hi) / 2;
      const b = await canvasToBlob(out, mime, q);
      if (b.size <= limit) {
        best = b;
        lo = q;
      } else {
        hi = q;
      }
    }
    if (!best) {
      throw new Error(`无法压缩到 ${opts.maxKB}KB 以内，请提高文件大小上限或选择 PNG 格式`);
    }
    blob = best;
  } else {
    blob = await canvasToBlob(out, mime, 0.92);
  }

  return new File([blob], `${stem(file.name)}.${ext}`, { type: mime });
}
