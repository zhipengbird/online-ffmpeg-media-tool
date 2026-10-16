import { stem } from "../utils/format";

export interface MemeOptions {
  topText: string;
  bottomText: string;
  fontSize: number;
  textColor: string;
  strokeColor: string;
  strokeWidth: number;
  format: "jpg" | "png";
  quality: number;
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = "";
    for (const char of paragraph) {
      const next = line + char;
      if (line && ctx.measureText(next).width > maxWidth) {
        lines.push(line);
        line = char;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function drawCaption(
  ctx: CanvasRenderingContext2D,
  text: string,
  y: number,
  lineHeight: number,
  maxWidth: number,
  align: "top" | "bottom",
) {
  if (!text.trim()) return;
  const lines = wrapText(ctx, text.trim(), maxWidth);
  const startY = align === "top" ? y : y - (lines.length - 1) * lineHeight;
  for (let i = 0; i < lines.length; i++) {
    const lineY = startY + i * lineHeight;
    ctx.strokeText(lines[i], ctx.canvas.width / 2, lineY);
    ctx.fillText(lines[i], ctx.canvas.width / 2, lineY);
  }
}

/** 使用浏览器 Canvas 生成标准上下文字 Meme 图，避免依赖系统字体和 FFmpeg drawtext。 */
export async function renderMeme(file: File, options: MemeOptions): Promise<File> {
  const bitmap = await createImageBitmap(file);
  try {
    const maxSide = 2400;
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("当前浏览器不支持 Canvas 图片编辑");

    ctx.drawImage(bitmap, 0, 0, width, height);

    const fontSize = Math.max(18, Math.round(Math.min(width, height) * Math.max(2, options.fontSize) / 100));
    const lineHeight = Math.round(fontSize * 1.12);
    ctx.font = `900 ${fontSize}px Impact, Haettenschweiler, "Arial Black", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.fillStyle = options.textColor;
    ctx.strokeStyle = options.strokeColor;
    ctx.lineWidth = Math.max(0, fontSize * Math.max(0, options.strokeWidth) / 100);

    drawCaption(ctx, options.topText, Math.max(fontSize * 0.9, lineHeight), lineHeight, width * 0.9, "top");
    drawCaption(ctx, options.bottomText, height - Math.max(fontSize * 0.9, lineHeight), lineHeight, width * 0.9, "bottom");

    const mime = options.format === "png" ? "image/png" : "image/jpeg";
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("Meme 图片导出失败"))), mime, options.quality / 100);
    });
    return new File([blob], `${stem(file.name)}-meme.${options.format}`, { type: mime });
  } finally {
    bitmap.close();
  }
}
