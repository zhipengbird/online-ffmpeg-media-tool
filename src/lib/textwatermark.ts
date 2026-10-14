import { stem } from "../utils/format";

/**
 * 文字水印图层（浏览器 Canvas 渲染）
 *
 * 用 Canvas 把文字绘制为带透明通道且与主图同尺寸 (W x H) 的 PNG，
 * 再由 FFmpeg 的 overlay 滤镜以 0:0 无偏移精准叠加到图片上。
 * 优点：
 *  - 直接使用系统内置中文字体，无需将数 MB 的 CJK 字体包编入应用；
 *  - 支持单行/多行、九宫格角标、居中、斜向平铺防盗水印；
 *  - 画布与主图 1:1 等大，彻底避免不同定位在 FFmpeg 滤镜解析时的坐标偏移与失真；
 *  - 字号按主图短边比例自适应缩放，批量处理多分辨率图片时视觉大小协调。
 */

export interface TextWatermarkOptions {
  text: string;
  /** lt | rt | lb | rb | center | tile（平铺） */
  position: string;
  /** 字号占图片短边的百分比 (1 ~ 15) */
  size?: number;
  sizePct?: number;
  /** 颜色，#RRGGBB */
  color: string;
  /** 不透明度 1 ~ 100 */
  opacity?: number;
  opacityPct?: number;
  bold?: boolean;
  shadow?: boolean;
  /** 旋转角度（度），负数为逆时针 */
  rotate?: number;
  rotateDeg?: number;
  /** 边距占图片尺寸的百分比 */
  margin?: number;
  marginPct?: number;
}

const FONT_STACK = [
  "-apple-system",
  "BlinkMacSystemFont",
  '"PingFang SC"',
  '"Hiragino Sans GB"',
  '"Microsoft YaHei"',
  '"Noto Sans CJK SC"',
  '"Source Han Sans SC"',
  '"WenQuanYi Micro Hei"',
  "Arial",
  "sans-serif",
].join(", ");

const LINE_HEIGHT = 1.35;

function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("浏览器不支持 Canvas 2D 绘图");
  return { canvas, ctx };
}

/** 获取主图真实像素宽高，包含 createImageBitmap 与 Image DOM 双重容错 */
async function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
  try {
    const bmp = await createImageBitmap(file);
    const width = bmp.width;
    const height = bmp.height;
    bmp.close();
    if (width > 0 && height > 0) return { width, height };
  } catch {
    // 降级为 Image 对象解析
  }

  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;
      URL.revokeObjectURL(url);
      if (width > 0 && height > 0) resolve({ width, height });
      else reject(new Error(`无法获取图片尺寸：${file.name}`));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`无法读取图片内容，请检查格式是否有效：${file.name}`));
    };
    img.src = url;
  });
}

/**
 * 生成与主图等大 (W x H) 的全幅透明水印 PNG 图层：
 * - 统一由 FFmpeg overlay 0:0 叠合，规避 FFmpeg 端坐标表达式误差
 */
export async function renderTextWatermark(main: File, o: TextWatermarkOptions): Promise<File> {
  const lines = (o.text || "")
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (lines.length === 0) throw new Error("请输入水印文字内容");

  const { width: W, height: H } = await getImageDimensions(main);

  const size = Number(o.sizePct ?? o.size) || 4;
  const opacity = Number(o.opacityPct ?? o.opacity) || 40;
  const rotate = Number(o.rotateDeg ?? o.rotate) || 0;
  const margin = Number(o.marginPct ?? o.margin) || 3;

  // 以图片短边计算基础字号，最小保证 12px
  const baseDim = Math.min(W, H);
  const fontPx = Math.max(12, Math.round((baseDim * size) / 100));
  const lineH = Math.round(fontPx * LINE_HEIGHT);
  const font = `${o.bold ? "bold " : ""}${fontPx}px ${FONT_STACK}`;

  // 测量文字实际宽高以计算旋转后外接框
  const measure = makeCanvas(1, 1).ctx;
  measure.font = font;
  const textW = Math.ceil(Math.max(...lines.map((l) => measure.measureText(l).width)));
  const textH = lineH * lines.length;

  const rad = (rotate * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const blockW = Math.ceil(textW * cos + textH * sin);
  const blockH = Math.ceil(textW * sin + textH * cos);

  // 创建与主图等尺寸的透明画布
  const { canvas, ctx } = makeCanvas(W, H);

  ctx.font = font;
  ctx.fillStyle = o.color || "#ffffff";
  ctx.globalAlpha = Math.min(1, Math.max(0.01, opacity / 100));
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  if (o.shadow) {
    ctx.shadowColor = "rgba(0, 0, 0, 0.65)";
    ctx.shadowBlur = Math.max(2, fontPx * 0.18);
    ctx.shadowOffsetX = Math.max(1, fontPx * 0.05);
    ctx.shadowOffsetY = Math.max(1, fontPx * 0.05);
  }

  // 以 (cx, cy) 为几何中心绘制文字块
  const drawBlock = (cx: number, cy: number) => {
    ctx.save();
    ctx.translate(cx, cy);
    if (rad !== 0) ctx.rotate(rad);
    lines.forEach((line, i) => {
      ctx.fillText(line, 0, (i - (lines.length - 1) / 2) * lineH);
    });
    ctx.restore();
  };

  const pos = o.position || "tile";

  if (pos === "tile") {
    // 倾斜全屏防盗平铺：奇数行错位交织
    const stepX = Math.max(textW + fontPx * 3, 100);
    const stepY = Math.max(textH + fontPx * 3, 80);
    const reach = Math.hypot(W, H);
    let row = 0;
    for (let y = -reach; y <= H + reach; y += stepY, row++) {
      const offset = row % 2 === 1 ? stepX / 2 : 0;
      for (let x = -reach + offset; x <= W + reach; x += stepX) {
        drawBlock(x, y);
      }
    }
  } else if (pos === "center") {
    // 正中心
    drawBlock(W / 2, H / 2);
  } else {
    // 边角九宫格位置
    const mx = Math.max(10, Math.round((W * margin) / 100));
    const my = Math.max(10, Math.round((H * margin) / 100));

    let cx = W / 2;
    let cy = H / 2;

    if (pos === "lt") {
      cx = mx + blockW / 2;
      cy = my + blockH / 2;
    } else if (pos === "rt") {
      cx = W - mx - blockW / 2;
      cy = my + blockH / 2;
    } else if (pos === "lb") {
      cx = mx + blockW / 2;
      cy = H - my - blockH / 2;
    } else if (pos === "rb") {
      cx = W - mx - blockW / 2;
      cy = H - my - blockH / 2;
    }

    drawBlock(cx, cy);
  }

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("水印图层生成失败"))), "image/png")
  );
  return new File([blob], `${stem(main.name)}-watermark.png`, { type: "image/png" });
}
