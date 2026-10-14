import { stem } from "../utils/format";

/**
 * 文字水印图层（浏览器 Canvas 渲染）
 *
 * 用 Canvas 把文字绘制为带透明通道的 PNG，再由 FFmpeg 的 overlay 滤镜叠加到图片上。
 * 优点：
 *  - 直接使用用户系统中的中文字体，无需把数 MB 的 CJK 字体打包进应用；
 *  - 支持多行、旋转、阴影、透明度、平铺，且与 FFmpeg 解耦；
 *  - 字号以图片宽度的百分比计算，批量处理时每张图自动适配。
 */

export interface TextWatermarkOptions {
  text: string;
  /** lt | rt | lb | rb | center | tile（平铺） */
  position: string;
  /** 字号占图片宽度的百分比 */
  size: number;
  /** 颜色，#RRGGBB */
  color: string;
  /** 不透明度 1 ~ 100 */
  opacity: number;
  bold: boolean;
  shadow: boolean;
  /** 旋转角度（度），负数为逆时针 */
  rotate: number;
}

const FONT_STACK = [
  '"PingFang SC"',
  '"Hiragino Sans GB"',
  '"Microsoft YaHei"',
  '"Noto Sans CJK SC"',
  '"Source Han Sans SC"',
  '"WenQuanYi Micro Hei"',
  "Arial",
  "sans-serif",
].join(", ");

const LINE_HEIGHT = 1.3;

function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("浏览器不支持 Canvas 2D");
  return { canvas, ctx };
}

/**
 * 生成与主图同名的水印图层 PNG：
 * - 普通位置：图层大小 = 文字外接框（含阴影留白），由 FFmpeg 按位置叠加；
 * - 平铺：图层大小 = 主图大小，斜向重复绘制文字，FFmpeg 以 0:0 叠加。
 */
export async function renderTextWatermark(main: File, o: TextWatermarkOptions): Promise<File> {
  const lines = o.text
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (lines.length === 0) throw new Error("请输入水印文字");

  let W = 0;
  let H = 0;
  try {
    const bmp = await createImageBitmap(main);
    W = bmp.width;
    H = bmp.height;
    bmp.close();
  } catch {
    throw new Error(`无法读取「${main.name}」，文字水印支持 JPG / PNG / WebP / BMP / GIF`);
  }

  const fontPx = Math.max(8, Math.round((W * o.size) / 100));
  const lineH = Math.round(fontPx * LINE_HEIGHT);
  const font = `${o.bold ? "bold " : ""}${fontPx}px ${FONT_STACK}`;

  // 先测量文字宽高，用于计算旋转后的外接框
  const measure = makeCanvas(1, 1).ctx;
  measure.font = font;
  const textW = Math.ceil(Math.max(...lines.map((l) => measure.measureText(l).width)));
  const textH = lineH * lines.length;

  const rad = (o.rotate * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const blockW = Math.ceil(textW * cos + textH * sin);
  const blockH = Math.ceil(textW * sin + textH * cos);

  const tile = o.position === "tile";
  const pad = o.shadow ? Math.ceil(fontPx * 0.25) : 0;
  const { canvas, ctx } = tile ? makeCanvas(W, H) : makeCanvas(blockW + pad * 2, blockH + pad * 2);

  ctx.font = font;
  ctx.fillStyle = o.color;
  ctx.globalAlpha = Math.min(1, Math.max(0.01, o.opacity / 100));
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (o.shadow) {
    ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
    ctx.shadowBlur = Math.max(2, fontPx * 0.15);
  }

  // 绘制一块（可多行、可旋转）的文字，以 (cx, cy) 为中心
  const drawBlock = (cx: number, cy: number) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rad);
    lines.forEach((line, i) => {
      ctx.fillText(line, 0, (i - (lines.length - 1) / 2) * lineH);
    });
    ctx.restore();
  };

  if (tile) {
    // 斜向平铺：奇数行错开半个步长，覆盖整张图（含旋转后的边缘）
    const stepX = Math.max(textW + fontPx * 2, 40);
    const stepY = Math.max(textH + fontPx * 2, 40);
    const reach = Math.hypot(W, H);
    let row = 0;
    for (let y = -reach; y <= H + reach; y += stepY, row++) {
      const offset = row % 2 === 1 ? stepX / 2 : 0;
      for (let x = -reach + offset; x <= W + reach; x += stepX) drawBlock(x, y);
    }
  } else {
    drawBlock(canvas.width / 2, canvas.height / 2);
  }

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("水印图层生成失败"))), "image/png")
  );
  return new File([blob], `${stem(main.name)}-watermark.png`, { type: "image/png" });
}
