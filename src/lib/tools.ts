import type { MediaInfo } from "./ffmpeg";
import { ID_BG, ID_SPECS, makeIdPhoto, specOf, specPx } from "./idphoto";
import { renderTextWatermark } from "./textwatermark";

export type Category = "video" | "audio" | "image";
export type FieldValue = string | number | boolean;
export type Values = Record<string, FieldValue>;

export interface Option {
  label: string;
  value: string;
}

/** 常用预设：选中后一次性写入多个参数 */
export interface Preset {
  value: string;
  label: string;
  hint?: string;
  values: Values;
}

export interface Field {
  key: string;
  label: string;
  /**
   * select：下拉框；chips：按钮组；number：数字输入；range：滑块；
   * checkbox：开关；presets：预设卡片（附带"自定义"选项）
   */
  type: "select" | "number" | "range" | "checkbox" | "chips" | "presets" | "text" | "color";
  default: FieldValue;
  options?: Option[];
  presets?: Preset[];
  /** 可选：选项随其他参数变化时使用（如水印位置在图片模式下不含平铺） */
  optionsFor?: (v: Values) => Option[];
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  hint?: string;
  visibleWhen?: (v: Values) => boolean;
}

export interface BuildContext {
  values: Values;
  /** 虚拟文件系统中的输入文件名，与 accept 顺序一致 */
  inputs: string[];
  infos: (MediaInfo | null)[];
}

export interface BuildResult {
  /** 不含输出文件名的 ffmpeg 参数 */
  args: string[];
  ext: string;
  mime: string;
}

export interface ToolDef {
  id: string;
  category: Category;
  name: string;
  icon: string;
  desc: string;
  /** 每个输入槽位的 accept，数组长度即输入文件数量 */
  accept: string[];
  inputLabels: string[];
  fields: Field[];
  build: (ctx: BuildContext) => BuildResult;
  /** 可选：根据当前参数给出的输出说明（如预估尺寸），显示在参数区下方 */
  outputHint?: (values: Values, infos: (MediaInfo | null)[]) => string;
  /**
   * 是否支持批量：为 true 时输入区可一次添加多个文件，
   * 处理时对每个文件单独调用一次 build()，并逐项输出结果（可打包 ZIP）。
   * 批量模式下 accept[0] 为文件类型过滤器，inputs / infos 长度均为 1。
   */
  multiple?: boolean;
  /**
   * 可选：FFmpeg 执行前的前置处理（运行在主线程 Canvas 中）。
   * 返回的文件会作为 FFmpeg 的输入，文件名扩展名决定输入格式。
   * 用于证件照抠图换底等 FFmpeg 无法完成的操作。
   */
  preprocess?: (file: File, values: Values) => Promise<File>;
  /**
   * 可选：叠加图层生成（如文字水印的透明 PNG）。返回 null 表示本次不需要图层。
   * 图层会追加在所有输入文件之后，成为 FFmpeg 的最后一个输入。
   */
  overlay?: (main: File, values: Values) => Promise<File | null>;
  /**
   * 可选：本次任务需要的输入文件数（默认等于 accept.length）。
   * 用于同一工具按参数切换输入数量，如水印的文字模式 1 张、图片模式 2 张。
   */
  inputCount?: (values: Values) => number;
}

export const CATEGORIES: { id: Category; label: string; icon: string }[] = [
  { id: "video", label: "视频处理", icon: "🎬" },
  { id: "audio", label: "音频处理", icon: "🎵" },
  { id: "image", label: "图片处理", icon: "🖼️" },
];

const VIDEO_ACCEPT = "video/*,.mp4,.mkv,.mov,.avi,.webm,.flv,.ts,.m4v,.3gp,.wmv";
const AUDIO_ACCEPT = "audio/*,.mp3,.wav,.flac,.ogg,.opus,.m4a,.aac,.wma,.amr";
const IMAGE_ACCEPT = "image/*,.png,.jpg,.jpeg,.webp,.bmp,.gif,.tif,.tiff";
const MEDIA_ACCEPT = `${VIDEO_ACCEPT},${AUDIO_ACCEPT}`;

/** 保证宽高为偶数（yuv420p 编码要求） */
const EVEN = "scale=trunc(iw/2)*2:trunc(ih/2)*2";

/** 图片扩展名（用于判断输入是否为静态图片） */
const IMAGE_EXT = /\.(png|jpe?g|webp|bmp|gif|tiff?)$/i;

const num = (v: Values, k: string) => Number(v[k]);
const str = (v: Values, k: string) => String(v[k]);

const X264 = (crf: number) => [
  "-c:v",
  "libx264",
  "-preset",
  "veryfast",
  "-crf",
  String(crf),
  "-pix_fmt",
  "yuv420p",
];
const AAC = (bitrate = "160k") => ["-c:a", "aac", "-b:a", bitrate];

/** 将速度倍率拆分为 atempo 链（atempo 单次范围为 0.5 ~ 2） */
export function atempoChain(speed: number): string {
  const parts: number[] = [];
  let s = speed;
  while (s > 2) {
    parts.push(2);
    s /= 2;
  }
  while (s < 0.5) {
    parts.push(0.5);
    s /= 0.5;
  }
  parts.push(Number(s.toFixed(4)));
  return parts.map((p) => `atempo=${p}`).join(",");
}

function videoContainer(format: string, crf: number): { ext: string; mime: string; args: string[] } {
  switch (format) {
    case "mkv":
      return { ext: "mkv", mime: "video/x-matroska", args: [...X264(crf), ...AAC()] };
    case "mov":
      return { ext: "mov", mime: "video/quicktime", args: [...X264(crf), ...AAC(), "-movflags", "+faststart"] };
    case "flv":
      return { ext: "flv", mime: "video/x-flv", args: [...X264(crf), ...AAC()] };
    case "webm":
      return {
        ext: "webm",
        mime: "video/webm",
        args: ["-c:v", "libvpx", "-b:v", "0", "-crf", String(Math.min(crf, 63)), "-cpu-used", "5", "-c:a", "libopus", "-b:a", "128k"],
      };
    case "avi":
      return {
        ext: "avi",
        mime: "video/x-msvideo",
        args: ["-c:v", "mpeg4", "-q:v", "4", "-c:a", "libmp3lame", "-q:a", "4"],
      };
    default:
      return { ext: "mp4", mime: "video/mp4", args: [...X264(crf), ...AAC(), "-movflags", "+faststart"] };
  }
}

interface AudioEncoder {
  ext: string;
  mime: string;
  args: string[];
}

function audioEncoder(format: string, bitrate: string): AudioEncoder {
  switch (format) {
    case "mp3":
      return { ext: "mp3", mime: "audio/mpeg", args: ["-c:a", "libmp3lame", "-b:a", bitrate] };
    case "m4a":
      return { ext: "m4a", mime: "audio/mp4", args: ["-c:a", "aac", "-b:a", bitrate] };
    case "wav":
      return { ext: "wav", mime: "audio/wav", args: ["-c:a", "pcm_s16le"] };
    case "flac":
      return { ext: "flac", mime: "audio/flac", args: ["-c:a", "flac"] };
    case "ogg":
      return { ext: "ogg", mime: "audio/ogg", args: ["-c:a", "libvorbis", "-b:a", bitrate] };
    case "opus":
      return { ext: "opus", mime: "audio/ogg", args: ["-c:a", "libopus", "-b:a", bitrate] };
    default:
      return { ext: "mp3", mime: "audio/mpeg", args: ["-c:a", "libmp3lame", "-b:a", bitrate] };
  }
}

/**
 * 图片输出参数（统一包含 -i 输入，修复此前缺少输入导致 "Output file does not contain any stream" 的问题）
 */
/** 图片编码参数（不含输入与滤镜），供所有图片输出类工具复用 */
function encodeArgs(format: string, quality: number): { ext: string; mime: string; args: string[] } {
  switch (format) {
    case "jpg":
      return {
        ext: "jpg",
        mime: "image/jpeg",
        // mjpeg 的 qscale 范围 2(最好)~31(最差)，映射自 1~100 的质量值
        args: ["-frames:v", "1", "-q:v", String(Math.round(2 + ((100 - quality) * 29) / 99))],
      };
    case "webp":
      return {
        ext: "webp",
        mime: "image/webp",
        args: ["-frames:v", "1", "-c:v", "libwebp", "-quality", String(quality)],
      };
    case "bmp":
      return { ext: "bmp", mime: "image/bmp", args: ["-frames:v", "1"] };
    case "gif":
      return { ext: "gif", mime: "image/gif", args: ["-frames:v", "1"] };
    default:
      return { ext: "png", mime: "image/png", args: ["-frames:v", "1"] };
  }
}

/**
 * 图片输出参数，统一包含 -i 输入（修复此前缺少输入导致 "Output file does not contain any stream" 的问题）
 */
function imageOutput(input: string, format: string, quality: number, vf: string[] = []): BuildResult {
  const enc = encodeArgs(format, quality);
  const pre = vf.length ? ["-vf", vf.join(",")] : [];
  return { ext: enc.ext, mime: enc.mime, args: ["-i", input, ...pre, ...enc.args] };
}

/* ---------------- 图片尺寸与宽高比规划 ---------------- */

export interface ResizePlan {
  /** 需要追加到 -vf 的滤镜 */
  vf: string[];
  /** 面向用户的输出尺寸说明 */
  desc: string;
}

const RATIO_MAP: Record<string, [number, number]> = {
  "1:1": [1, 1],
  "4:3": [4, 3],
  "3:2": [3, 2],
  "16:9": [16, 9],
  "9:16": [9, 16],
};

const RATIO_OPTIONS: Option[] = [
  { label: "原始比例", value: "original" },
  { label: "1:1 正方形", value: "1:1" },
  { label: "4:3", value: "4:3" },
  { label: "3:2", value: "3:2" },
  { label: "16:9 宽屏", value: "16:9" },
  { label: "9:16 竖屏", value: "9:16" },
];

const FIT_OPTIONS: Option[] = [
  { label: "居中裁剪（填满）", value: "cover" },
  { label: "等比缩放（不裁剪）", value: "contain" },
];

/** 常用预设：一键套用后仍可在下方自定义修改 */
const COMPRESS_PRESETS: Preset[] = [
  {
    value: "social",
    label: "朋友圈 / 社交媒体",
    hint: "宽 1080 · JPG · 质量 80",
    values: { ratio: "original", fit: "contain", width: 1080, height: 0, format: "jpg", quality: 80 },
  },
  {
    value: "web",
    label: "网站配图",
    hint: "宽 1200 · WebP · 质量 80",
    values: { ratio: "original", fit: "contain", width: 1200, height: 0, format: "webp", quality: 80 },
  },
  {
    value: "mail",
    label: "邮件附件（小体积）",
    hint: "宽 800 · JPG · 质量 65",
    values: { ratio: "original", fit: "contain", width: 800, height: 0, format: "jpg", quality: 65 },
  },
  {
    value: "thumb",
    label: "缩略图（正方形）",
    hint: "300×300 · 1:1 裁剪 · WebP",
    values: { ratio: "1:1", fit: "cover", width: 300, height: 300, format: "webp", quality: 75 },
  },
  {
    value: "avatar",
    label: "头像",
    hint: "512×512 · 1:1 裁剪 · JPG 90",
    values: { ratio: "1:1", fit: "cover", width: 512, height: 512, format: "jpg", quality: 90 },
  },
  {
    value: "cover",
    label: "视频封面（横版）",
    hint: "1920×1080 · 16:9 裁剪 · JPG 85",
    values: { ratio: "16:9", fit: "cover", width: 1920, height: 1080, format: "jpg", quality: 85 },
  },
  {
    value: "poster",
    label: "竖版海报",
    hint: "1080×1920 · 9:16 裁剪 · JPG 85",
    values: { ratio: "9:16", fit: "cover", width: 1080, height: 1920, format: "jpg", quality: 85 },
  },
  {
    value: "lossless",
    label: "无损 PNG（仅缩放）",
    hint: "保持原尺寸 · PNG 无损",
    values: { ratio: "original", fit: "contain", width: 0, height: 0, format: "png", quality: 90 },
  },
];

const clampInt = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0);

/** 在原图中居中截取指定比例的最大区域 */
function cropBox(iw: number, ih: number, ratio: number): { w: number; h: number } {
  if (iw / ih > ratio) return { w: Math.round(ih * ratio), h: ih };
  return { w: iw, h: Math.round(iw / ratio) };
}

/** 居中裁剪到目标比例（不缩放），使用 ffmpeg 表达式计算裁剪区域 */
function cropExpr(rw: number, rh: number): string {
  return `crop=w='min(iw,ih*${rw}/${rh})':h='min(ih,iw*${rh}/${rw})'`;
}

/**
 * 根据宽高设置、宽高比、裁剪方式计算滤镜与输出尺寸。
 * info 可选：已读取到原图尺寸时可精确预估输出，并支持"不放大"。
 */
export function planResize(values: Values, info?: MediaInfo | null): ResizePlan {
  const W = clampInt(num(values, "width"));
  const H = clampInt(num(values, "height"));
  const key = str(values, "ratio");
  const noUp = values.noUpscale === true;
  const iw = info?.width ?? 0;
  const ih = info?.height ?? 0;
  const hasSrc = iw > 0 && ih > 0;
  const ratioPair = RATIO_MAP[key];

  // 1) 未设置任何尺寸
  if (W === 0 && H === 0) {
    if (!ratioPair) {
      return { vf: [], desc: hasSrc ? `保持原尺寸 ${iw}×${ih}` : "保持原尺寸" };
    }
    const [rw, rh] = ratioPair;
    const desc = hasSrc
      ? `居中裁剪为 ${rw}:${rh}，输出约 ${cropBox(iw, ih, rw / rh).w}×${cropBox(iw, ih, rw / rh).h}`
      : `居中裁剪为 ${rw}:${rh}`;
    return { vf: [cropExpr(rw, rh)], desc };
  }

  // 2) 原始比例：只缩放，不改变宽高比
  if (!ratioPair) {
    const vf = W && H ? [`scale=${W}:${H}:force_original_aspect_ratio=decrease`] : [`scale=${W || -2}:${H || -2}`];
    if (!hasSrc) return { vf, desc: "按设定尺寸等比缩放" };
    const s = W && H ? Math.min(W / iw, H / ih) : W ? W / iw : H / ih;
    if (noUp && s >= 1) return { vf: [], desc: `不放大，保持原尺寸 ${iw}×${ih}` };
    return { vf, desc: `等比缩放，输出约 ${Math.round(iw * s)}×${Math.round(ih * s)}` };
  }

  // 3) 固定宽高比：缺失的一边按比例推算
  const [rw, rh] = ratioPair;
  const ratio = rw / rh;
  const tw = W || Math.round(H * ratio);
  const th = H || Math.round(W / ratio);
  const cover = str(values, "fit") !== "contain";
  const s = hasSrc ? (cover ? Math.max(tw / iw, th / ih) : Math.min(tw / iw, th / ih)) : 0;

  // 目标尺寸大于原图且不允许放大：退化为原图分辨率下的裁剪 / 保持
  if (noUp && hasSrc && s > 1) {
    if (cover) {
      const b = cropBox(iw, ih, ratio);
      return { vf: [cropExpr(rw, rh)], desc: `目标大于原图，改为原分辨率居中裁剪 ${rw}:${rh}，输出约 ${b.w}×${b.h}` };
    }
    return { vf: [], desc: `目标大于原图，不放大，保持原尺寸 ${iw}×${ih}` };
  }

  if (cover) {
    return {
      vf: [`scale=${tw}:${th}:force_original_aspect_ratio=increase`, `crop=${tw}:${th}`],
      desc: `居中裁剪为 ${tw}×${th}（${rw}:${rh}）`,
    };
  }
  return {
    vf: [`scale=${tw}:${th}:force_original_aspect_ratio=decrease`],
    desc: hasSrc
      ? `等比缩放，输出约 ${Math.round(iw * s)}×${Math.round(ih * s)}`
      : `等比缩放，不超过 ${tw}×${th}`,
  };
}

const TIME_FIELD = (key: string, label: string, def: number, hint?: string): Field => ({
  key,
  label,
  type: "number",
  default: def,
  min: 0,
  step: 0.1,
  unit: "秒",
  hint,
});

const QUALITY_FIELD: Field = {
  key: "quality",
  label: "输出质量",
  type: "range",
  default: 90,
  min: 1,
  max: 100,
  hint: "仅对 JPG / WebP 有效",
};

const IMG_QUALITY_VISIBLE = (v: Values) => ["jpg", "webp"].includes(str(v, "format"));

/* ---------------- 证件照与扩展图片工具的常量 ---------------- */

/** 证件照与图片扩展工具只接受浏览器可直接解码的格式（TIFF 等无法在 Canvas 中解码） */
const PHOTO_ACCEPT = "image/*,.png,.jpg,.jpeg,.webp,.bmp,.gif";

const pixelMode = (v: Values) => str(v, "mode") === "pixel";
const ratioMode = (v: Values) => str(v, "mode") === "ratio";

/** 证件照常用规格预设（尺寸以各机构官方要求为准） */
const ID_PRESETS: Preset[] = [
  {
    value: "1inch-white",
    label: "一寸白底",
    hint: "25×35mm · JPG ≤200KB",
    values: { spec: "1inch", bg: "white", format: "jpg", maxKB: "200", zoom: 100, offsetY: 0 },
  },
  {
    value: "1inch-blue",
    label: "一寸蓝底",
    hint: "25×35mm · JPG ≤200KB",
    values: { spec: "1inch", bg: "blue", format: "jpg", maxKB: "200", zoom: 100, offsetY: 0 },
  },
  {
    value: "1inch-red",
    label: "一寸红底",
    hint: "25×35mm · JPG ≤200KB",
    values: { spec: "1inch", bg: "red", format: "jpg", maxKB: "200", zoom: 100, offsetY: 0 },
  },
  {
    value: "2inch-white",
    label: "二寸白底",
    hint: "35×49mm · JPG ≤200KB",
    values: { spec: "2inch", bg: "white", format: "jpg", maxKB: "200", zoom: 100, offsetY: 0 },
  },
  {
    value: "2inch-red",
    label: "二寸红底",
    hint: "35×49mm · JPG ≤200KB",
    values: { spec: "2inch", bg: "red", format: "jpg", maxKB: "200", zoom: 100, offsetY: 0 },
  },
  {
    value: "passport",
    label: "护照白底",
    hint: "33×48mm · JPG ≤200KB",
    values: { spec: "passport", bg: "white", format: "jpg", maxKB: "200", zoom: 100, offsetY: 0 },
  },
];

/** 滤镜风格：FFmpeg 滤镜表达式 */
const FILTER_STYLES: { value: string; label: string; vf: string }[] = [
  { value: "bw", label: "黑白", vf: "hue=s=0" },
  { value: "sepia", label: "怀旧", vf: "colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131" },
  { value: "vintage", label: "复古胶片", vf: "curves=preset=vintage" },
  { value: "warm", label: "暖色", vf: "colorbalance=rs=0.15:gs=0.05:bs=-0.15" },
  { value: "cool", label: "冷色", vf: "colorbalance=rs=-0.15:bs=0.15" },
  { value: "vivid", label: "鲜艳", vf: "eq=saturation=1.6:contrast=1.1" },
  { value: "invert", label: "反色", vf: "negate" },
];

/** 边框颜色（FFmpeg 颜色写法 0xRRGGBB） */
const BORDER_COLORS: { value: string; label: string; hex: string }[] = [
  { value: "white", label: "白色", hex: "0xffffff" },
  { value: "black", label: "黑色", hex: "0x000000" },
  { value: "gray", label: "浅灰", hex: "0xe5e7eb" },
  { value: "blue", label: "蓝色", hex: "0x438edb" },
];

/* ---------------- 文字水印的常量 ---------------- */

/** 水印类型：文字模式为默认，图片模式需要第二张水印图 */
const textMode = (v: Values) => str(v, "mode") !== "image";
const imageMode = (v: Values) => str(v, "mode") === "image";

/** 图片水印的位置（平铺需要重复绘制 Logo，暂不支持，因此不列出） */
const IMG_WM_POSITIONS: Option[] = [
  { label: "左上", value: "lt" },
  { label: "右上", value: "rt" },
  { label: "左下", value: "lb" },
  { label: "右下", value: "rb" },
  { label: "居中", value: "center" },
];

const TEXT_WM_POSITIONS: Option[] = [
  { label: "左上", value: "lt" },
  { label: "右上", value: "rt" },
  { label: "左下", value: "lb" },
  { label: "右下", value: "rb" },
  { label: "居中", value: "center" },
  { label: "平铺（满屏）", value: "tile" },
];

const TEXT_WM_PRESETS: Preset[] = [
  {
    value: "tile-copyright",
    label: "平铺版权",
    hint: "斜向满屏 · 白字阴影",
    values: { text: "© 版权所有 请勿盗用", position: "tile", size: 4, color: "#ffffff", opacity: 35, bold: false, shadow: true, rotate: -30 },
  },
  {
    value: "corner-name",
    label: "右下角署名",
    hint: "右下角 · 小号加粗",
    values: { text: "@你的名字", position: "rb", size: 3, color: "#ffffff", opacity: 85, bold: true, shadow: true, rotate: 0 },
  },
  {
    value: "confidential",
    label: "机密标识",
    hint: "居中斜纹 · 红色",
    values: { text: "机密 CONFIDENTIAL", position: "center", size: 7, color: "#dc2626", opacity: 35, bold: true, shadow: false, rotate: -30 },
  },
  {
    value: "for-use",
    label: "仅供办理使用",
    hint: "平铺 · 防止挪作他用",
    values: { text: "仅供办理使用\n请勿他用", position: "tile", size: 3.5, color: "#ffffff", opacity: 40, bold: false, shadow: true, rotate: -25 },
  },
  {
    value: "custom",
    label: "自定义",
    hint: "手动设置下方各项参数",
    values: {},
  },
];

export const TOOLS: ToolDef[] = [
  // ================= 视频 =================
  {
    id: "video-convert",
    category: "video",
    name: "视频格式转换",
    icon: "🔄",
    desc: "在 MP4 / MKV / MOV / WebM / AVI / FLV 等容器之间互相转换。",
    accept: [VIDEO_ACCEPT],
    inputLabels: ["视频文件"],
    fields: [
      {
        key: "format",
        label: "输出格式",
        type: "select",
        default: "mp4",
        options: [
          { label: "MP4 (H.264 + AAC)", value: "mp4" },
          { label: "MOV (QuickTime)", value: "mov" },
          { label: "MKV (Matroska)", value: "mkv" },
          { label: "WebM (VP8 + Opus)", value: "webm" },
          { label: "AVI (MPEG-4)", value: "avi" },
          { label: "FLV (Flash)", value: "flv" },
        ],
      },
      { key: "crf", label: "画质 (CRF)", type: "range", default: 23, min: 0, max: 51, hint: "越小画质越高、体积越大" },
    ],
    build: ({ values, inputs }) => {
      const c = videoContainer(str(values, "format"), num(values, "crf"));
      return { args: ["-i", inputs[0], "-vf", EVEN, ...c.args], ext: c.ext, mime: c.mime };
    },
  },
  {
    id: "video-compress",
    category: "video",
    name: "视频压缩",
    icon: "🗜️",
    desc: "通过 H.264 重新编码降低体积，可同时缩小分辨率与音频码率。",
    accept: [VIDEO_ACCEPT],
    inputLabels: ["视频文件"],
    fields: [
      { key: "crf", label: "压缩强度 (CRF)", type: "range", default: 28, min: 18, max: 40, hint: "推荐 26~32" },
      {
        key: "preset",
        label: "编码速度 (preset)",
        type: "select",
        default: "veryfast",
        options: [
          { label: "ultrafast（最快，体积最大）", value: "ultrafast" },
          { label: "veryfast（推荐）", value: "veryfast" },
          { label: "faster", value: "faster" },
          { label: "medium", value: "medium" },
          { label: "slow（最慢，体积最小）", value: "slow" },
        ],
      },
      {
        key: "scale",
        label: "输出高度",
        type: "select",
        default: "720",
        options: [
          { label: "保持原始分辨率", value: "0" },
          { label: "1080p", value: "1080" },
          { label: "720p", value: "720" },
          { label: "480p", value: "480" },
          { label: "360p", value: "360" },
        ],
      },
      {
        key: "audioBitrate",
        label: "音频码率",
        type: "select",
        default: "96k",
        options: [
          { label: "64 kbps", value: "64k" },
          { label: "96 kbps", value: "96k" },
          { label: "128 kbps", value: "128k" },
        ],
      },
    ],
    build: ({ values, inputs }) => {
      const h = str(values, "scale");
      const filters = h !== "0" ? [`scale=-2:${h}`, EVEN] : [EVEN];
      return {
        args: [
          "-i",
          inputs[0],
          "-vf",
          filters.join(","),
          "-c:v",
          "libx264",
          "-preset",
          str(values, "preset"),
          "-crf",
          String(num(values, "crf")),
          "-pix_fmt",
          "yuv420p",
          ...AAC(str(values, "audioBitrate")),
          "-movflags",
          "+faststart",
        ],
        ext: "mp4",
        mime: "video/mp4",
      };
    },
  },
  {
    id: "video-resize",
    category: "video",
    name: "视频分辨率调整",
    icon: "📐",
    desc: "自定义输出宽高，填 0 表示按原始比例自动计算。",
    accept: [VIDEO_ACCEPT],
    inputLabels: ["视频文件"],
    fields: [
      { key: "width", label: "宽度", type: "number", default: 0, min: 0, max: 7680, unit: "px", hint: "0 = 自动" },
      { key: "height", label: "高度", type: "number", default: 720, min: 0, max: 4320, unit: "px", hint: "0 = 自动" },
    ],
    build: ({ values, inputs }) => {
      const w = num(values, "width");
      const h = num(values, "height");
      if (w <= 0 && h <= 0) throw new Error("请至少填写宽度或高度");
      const scale = `scale=${w > 0 ? Math.round(w) : -2}:${h > 0 ? Math.round(h) : -2}`;
      return {
        args: ["-i", inputs[0], "-vf", `${scale},${EVEN}`, ...X264(23), ...AAC(), "-movflags", "+faststart"],
        ext: "mp4",
        mime: "video/mp4",
      };
    },
  },
  {
    id: "video-transform",
    category: "video",
    name: "视频旋转 / 翻转",
    icon: "🔁",
    desc: "顺时针或逆时针旋转、180° 旋转以及水平、垂直翻转。",
    accept: [VIDEO_ACCEPT],
    inputLabels: ["视频文件"],
    fields: [
      {
        key: "op",
        label: "操作",
        type: "select",
        default: "cw90",
        options: [
          { label: "顺时针旋转 90°", value: "cw90" },
          { label: "逆时针旋转 90°", value: "ccw90" },
          { label: "旋转 180°", value: "r180" },
          { label: "水平翻转", value: "hflip" },
          { label: "垂直翻转", value: "vflip" },
        ],
      },
    ],
    build: ({ values, inputs }) => {
      const map: Record<string, string> = {
        cw90: "transpose=1",
        ccw90: "transpose=2",
        r180: "transpose=1,transpose=1",
        hflip: "hflip",
        vflip: "vflip",
      };
      const vf = map[str(values, "op")] ?? "transpose=1";
      return {
        args: ["-i", inputs[0], "-vf", `${vf},${EVEN}`, ...X264(23), ...AAC(), "-movflags", "+faststart"],
        ext: "mp4",
        mime: "video/mp4",
      };
    },
  },
  {
    id: "video-trim",
    category: "video",
    name: "视频剪切",
    icon: "✂️",
    desc: "截取视频的任意片段。精确模式会重新编码，快速模式直接复制流（速度快，但可能在关键帧处对齐）。",
    accept: [VIDEO_ACCEPT],
    inputLabels: ["视频文件"],
    fields: [
      TIME_FIELD("start", "开始时间", 0),
      TIME_FIELD("end", "结束时间", 0, "0 = 直到视频末尾"),
      {
        key: "mode",
        label: "剪切模式",
        type: "select",
        default: "precise",
        options: [
          { label: "精确剪切（重新编码）", value: "precise" },
          { label: "快速剪切（直接复制流）", value: "fast" },
        ],
      },
    ],
    build: ({ values, inputs, infos }) => {
      const start = num(values, "start");
      const end = num(values, "end");
      const duration = infos[0]?.duration ?? 0;
      let dur: number | null = null;
      if (end > 0) {
        if (end <= start) throw new Error("结束时间必须大于开始时间");
        dur = end - start;
      } else if (duration > 0) {
        if (duration <= start) throw new Error("开始时间超出视频时长");
        dur = duration - start;
      }
      const args = ["-ss", String(start), "-i", inputs[0]];
      if (dur !== null) args.push("-t", dur.toFixed(3));
      if (str(values, "mode") === "fast") {
        args.push("-c", "copy");
      } else {
        args.push(...X264(20), ...AAC(), "-movflags", "+faststart");
      }
      return { args, ext: "mp4", mime: "video/mp4" };
    },
  },
  {
    id: "video-speed",
    category: "video",
    name: "视频变速",
    icon: "⏩",
    desc: "慢放或快放视频，同时自动调整音频音调保持正常（需要视频包含音轨）。",
    accept: [VIDEO_ACCEPT],
    inputLabels: ["视频文件"],
    fields: [
      {
        key: "speed",
        label: "播放速度",
        type: "select",
        default: "2",
        options: [
          { label: "0.25x", value: "0.25" },
          { label: "0.5x", value: "0.5" },
          { label: "0.75x", value: "0.75" },
          { label: "1.25x", value: "1.25" },
          { label: "1.5x", value: "1.5" },
          { label: "2x", value: "2" },
          { label: "3x", value: "3" },
          { label: "4x", value: "4" },
        ],
      },
    ],
    build: ({ values, inputs, infos }) => {
      const sp = Number(str(values, "speed"));
      const hasAudio = infos[0]?.hasAudio === true;
      if (!hasAudio) {
        return {
          args: ["-i", inputs[0], "-vf", `setpts=PTS/${sp},${EVEN}`, ...X264(23), "-movflags", "+faststart"],
          ext: "mp4",
          mime: "video/mp4",
        };
      }
      const fc = `[0:v]setpts=PTS/${sp},${EVEN}[v];[0:a]${atempoChain(sp)}[a]`;
      return {
        args: ["-i", inputs[0], "-filter_complex", fc, "-map", "[v]", "-map", "[a]", ...X264(23), ...AAC(), "-movflags", "+faststart"],
        ext: "mp4",
        mime: "video/mp4",
      };
    },
  },
  {
    id: "video-gif",
    category: "video",
    name: "视频转 GIF",
    icon: "🖼️",
    desc: "截取视频片段并使用调色板算法生成高质量 GIF 动图。",
    accept: [VIDEO_ACCEPT],
    inputLabels: ["视频文件"],
    fields: [
      TIME_FIELD("start", "开始时间", 0),
      TIME_FIELD("duration", "持续时长", 5, "0 = 整个视频（可能很大）"),
      { key: "fps", label: "帧率 (FPS)", type: "range", default: 10, min: 1, max: 30, hint: "越高越流畅、体积越大" },
      { key: "width", label: "宽度", type: "number", default: 480, min: 16, max: 1920, unit: "px", hint: "高度按比例" },
    ],
    build: ({ values, inputs }) => {
      const start = num(values, "start");
      const dur = num(values, "duration");
      const args = ["-ss", String(start)];
      if (dur > 0) args.push("-t", String(dur));
      args.push(
        "-i",
        inputs[0],
        "-vf",
        `fps=${num(values, "fps")},scale=${Math.round(num(values, "width"))}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer`
      );
      return { args, ext: "gif", mime: "image/gif" };
    },
  },
  {
    id: "video-mute",
    category: "video",
    name: "去除音轨（静音）",
    icon: "🔇",
    desc: "删除视频中的音频轨道，画面保持原样且不重新编码。",
    accept: [VIDEO_ACCEPT],
    inputLabels: ["视频文件"],
    fields: [
      {
        key: "format",
        label: "输出格式",
        type: "select",
        default: "mp4",
        options: [
          { label: "MP4", value: "mp4" },
          { label: "MKV", value: "mkv" },
        ],
      },
    ],
    build: ({ values, inputs }) => {
      const isMkv = str(values, "format") === "mkv";
      return {
        args: ["-i", inputs[0], "-map", "0:v", "-an", "-c:v", "copy"],
        ext: isMkv ? "mkv" : "mp4",
        mime: isMkv ? "video/x-matroska" : "video/mp4",
      };
    },
  },
  {
    id: "video-frame",
    category: "video",
    name: "视频截图",
    icon: "📸",
    desc: "截取视频指定时间点的一帧画面，保存为图片。",
    accept: [VIDEO_ACCEPT],
    inputLabels: ["视频文件"],
    fields: [
      TIME_FIELD("time", "截取时间点", 1),
      {
        key: "format",
        label: "图片格式",
        type: "select",
        default: "png",
        options: [
          { label: "PNG（无损）", value: "png" },
          { label: "JPG", value: "jpg" },
          { label: "WebP", value: "webp" },
        ],
      },
    ],
    build: ({ values, inputs }) => {
      const fmt = str(values, "format");
      const args = ["-ss", String(num(values, "time")), "-i", inputs[0], "-frames:v", "1"];
      if (fmt === "jpg") {
        args.push("-q:v", "2");
        return { args, ext: "jpg", mime: "image/jpeg" };
      }
      if (fmt === "webp") {
        args.push("-quality", "90");
        return { args, ext: "webp", mime: "image/webp" };
      }
      return { args, ext: "png", mime: "image/png" };
    },
  },
  {
    id: "video-img2vid",
    category: "video",
    name: "图片转视频",
    icon: "🎞️",
    desc: "将一张图片生成指定时长的 MP4 视频，可用于制作幻灯片或封面视频。",
    accept: [IMAGE_ACCEPT],
    inputLabels: ["图片文件"],
    fields: [
      { key: "duration", label: "视频时长", type: "number", default: 5, min: 0.1, max: 3600, step: 0.5, unit: "秒" },
      { key: "fps", label: "帧率 (FPS)", type: "number", default: 25, min: 1, max: 60 },
    ],
    build: ({ values, inputs }) => {
      // "-loop" 只对图片解复用器（image2）有效。输入为视频等其他文件时，
      // FFmpeg 会报 "Option loop not found"，因此这里提前给出清晰的中文提示。
      if (!IMAGE_EXT.test(inputs[0])) {
        throw new Error("图片转视频只接受图片文件作为输入（PNG / JPG / WebP / BMP / GIF / TIFF）");
      }
      return {
        args: [
          "-loop",
          "1",
          "-i",
          inputs[0],
          "-t",
          String(num(values, "duration")),
          "-vf",
          EVEN,
          "-r",
          String(num(values, "fps")),
          ...X264(23),
          "-movflags",
          "+faststart",
        ],
        ext: "mp4",
        mime: "video/mp4",
      };
    },
  },
  {
    id: "video-merge-av",
    category: "video",
    name: "音视频合并（替换音轨）",
    icon: "🔗",
    desc: "将一个音频文件作为新音轨合并到视频中，原视频音轨会被替换。",
    accept: [VIDEO_ACCEPT, AUDIO_ACCEPT],
    inputLabels: ["视频文件（画面）", "音频文件（新音轨）"],
    fields: [
      {
        key: "audioBitrate",
        label: "音频码率",
        type: "select",
        default: "192k",
        options: [
          { label: "128 kbps", value: "128k" },
          { label: "192 kbps", value: "192k" },
          { label: "256 kbps", value: "256k" },
        ],
      },
    ],
    build: ({ values, inputs }) => ({
      args: [
        "-i",
        inputs[0],
        "-i",
        inputs[1],
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:v",
        "copy",
        ...AAC(str(values, "audioBitrate")),
        "-shortest",
        "-movflags",
        "+faststart",
      ],
      ext: "mp4",
      mime: "video/mp4",
    }),
  },

  // ================= 音频 =================
  {
    id: "audio-convert",
    category: "audio",
    name: "音频格式转换 / 提取音轨",
    icon: "🔊",
    desc: "音频格式互转；也可以直接上传视频，提取其中的音轨。",
    accept: [MEDIA_ACCEPT],
    inputLabels: ["音频 / 视频文件"],
    fields: [
      {
        key: "format",
        label: "输出格式",
        type: "select",
        default: "mp3",
        options: [
          { label: "MP3", value: "mp3" },
          { label: "M4A (AAC)", value: "m4a" },
          { label: "WAV (无损)", value: "wav" },
          { label: "FLAC (无损)", value: "flac" },
          { label: "OGG (Vorbis)", value: "ogg" },
          { label: "OPUS", value: "opus" },
        ],
      },
      {
        key: "bitrate",
        label: "码率",
        type: "select",
        default: "192k",
        options: [
          { label: "96 kbps", value: "96k" },
          { label: "128 kbps", value: "128k" },
          { label: "192 kbps", value: "192k" },
          { label: "256 kbps", value: "256k" },
          { label: "320 kbps", value: "320k" },
        ],
        visibleWhen: (v) => ["mp3", "m4a", "ogg", "opus"].includes(str(v, "format")),
      },
    ],
    build: ({ values, inputs }) => {
      const enc = audioEncoder(str(values, "format"), str(values, "bitrate"));
      return { args: ["-i", inputs[0], "-vn", ...enc.args], ext: enc.ext, mime: enc.mime };
    },
  },
  {
    id: "audio-edit",
    category: "audio",
    name: "音频剪切 / 音量 / 淡入淡出",
    icon: "🎚️",
    desc: "截取音频片段，调整音量，并添加淡入、淡出效果。",
    accept: [MEDIA_ACCEPT],
    inputLabels: ["音频 / 视频文件"],
    fields: [
      TIME_FIELD("start", "开始时间", 0),
      TIME_FIELD("end", "结束时间", 0, "0 = 直到末尾"),
      {
        key: "volume",
        label: "音量",
        type: "select",
        default: "1",
        options: [
          { label: "50%", value: "0.5" },
          { label: "80%", value: "0.8" },
          { label: "100%（原始）", value: "1" },
          { label: "150%", value: "1.5" },
          { label: "200%", value: "2" },
          { label: "300%", value: "3" },
        ],
      },
      TIME_FIELD("fadeIn", "淡入时长", 0),
      TIME_FIELD("fadeOut", "淡出时长", 0),
      {
        key: "format",
        label: "输出格式",
        type: "select",
        default: "mp3",
        options: [
          { label: "MP3", value: "mp3" },
          { label: "M4A (AAC)", value: "m4a" },
          { label: "WAV", value: "wav" },
          { label: "FLAC", value: "flac" },
        ],
      },
      {
        key: "bitrate",
        label: "码率",
        type: "select",
        default: "192k",
        options: [
          { label: "128 kbps", value: "128k" },
          { label: "192 kbps", value: "192k" },
          { label: "320 kbps", value: "320k" },
        ],
        visibleWhen: (v) => ["mp3", "m4a"].includes(str(v, "format")),
      },
    ],
    build: ({ values, inputs, infos }) => {
      const start = num(values, "start");
      const end = num(values, "end");
      const duration = infos[0]?.duration ?? 0;
      let dur: number | null = null;
      if (end > 0) {
        if (end <= start) throw new Error("结束时间必须大于开始时间");
        dur = end - start;
      } else if (duration > 0) {
        dur = duration - start;
      }

      const filters: string[] = [];
      const vol = num(values, "volume");
      if (vol !== 1) filters.push(`volume=${vol}`);

      const fadeIn = num(values, "fadeIn");
      if (fadeIn > 0) filters.push(`afade=t=in:st=0:d=${fadeIn}`);

      const fadeOut = num(values, "fadeOut");
      if (fadeOut > 0) {
        if (dur === null) throw new Error("无法获取音频时长，无法设置淡出效果");
        filters.push(`afade=t=out:st=${Math.max(0, dur - fadeOut).toFixed(3)}:d=${fadeOut}`);
      }

      const args = ["-ss", String(start), "-i", inputs[0]];
      if (dur !== null) args.push("-t", dur.toFixed(3));
      if (filters.length) args.push("-af", filters.join(","));
      const enc = audioEncoder(str(values, "format"), str(values, "bitrate"));
      args.push("-vn", ...enc.args);
      return { args, ext: enc.ext, mime: enc.mime };
    },
  },

  // ================= 图片 =================
  {
    id: "image-convert",
    category: "image",
    name: "图片格式转换",
    icon: "🔁",
    desc: "在 PNG / JPG / WebP / BMP / GIF 之间互相转换。",
    accept: [IMAGE_ACCEPT],
    inputLabels: ["图片文件"],
    fields: [
      {
        key: "format",
        label: "输出格式",
        type: "select",
        default: "png",
        options: [
          { label: "PNG（无损、支持透明）", value: "png" },
          { label: "JPG（有损、体积小）", value: "jpg" },
          { label: "WebP（现代格式）", value: "webp" },
          { label: "BMP", value: "bmp" },
          { label: "GIF", value: "gif" },
        ],
      },
      { ...QUALITY_FIELD, visibleWhen: IMG_QUALITY_VISIBLE },
    ],
    build: ({ values, inputs }) => imageOutput(inputs[0], str(values, "format"), num(values, "quality")),
  },
  {
    id: "image-compress",
    category: "image",
    name: "图片压缩 / 缩放",
    icon: "🗜️",
    desc: "选择常用预设一键压缩，支持一次添加多张图片批量处理，可自定义尺寸、宽高比与质量。",
    multiple: true,
    accept: [IMAGE_ACCEPT],
    inputLabels: ["图片文件"],
    fields: [
      { key: "preset", label: "常用预设", type: "presets", default: "social", presets: COMPRESS_PRESETS },
      { key: "ratio", label: "宽高比", type: "chips", default: "original", options: RATIO_OPTIONS },
      {
        key: "fit",
        label: "裁剪方式",
        type: "chips",
        default: "cover",
        options: FIT_OPTIONS,
        visibleWhen: (v) => str(v, "ratio") !== "original",
        hint: "仅在指定宽高比时生效",
      },
      { key: "width", label: "宽度", type: "number", default: 1080, min: 0, max: 16000, unit: "px", hint: "0 = 自动" },
      { key: "height", label: "高度", type: "number", default: 0, min: 0, max: 16000, unit: "px", hint: "0 = 自动" },
      {
        key: "noUpscale",
        label: "不放大图片（目标大于原图时保持原尺寸）",
        type: "checkbox",
        default: true,
      },
      {
        key: "format",
        label: "输出格式",
        type: "select",
        default: "jpg",
        options: [
          { label: "JPG（体积小）", value: "jpg" },
          { label: "WebP（体积更小，现代格式）", value: "webp" },
          { label: "PNG（无损、支持透明）", value: "png" },
        ],
      },
      { ...QUALITY_FIELD, default: 80, visibleWhen: IMG_QUALITY_VISIBLE },
    ],
    outputHint: (values, infos) => `输出尺寸：${planResize(values, infos[0]).desc}`,
    build: ({ values, inputs, infos }) => {
      const plan = planResize(values, infos[0]);
      return imageOutput(inputs[0], str(values, "format"), num(values, "quality"), plan.vf);
    },
  },
  {
    id: "image-adjust",
    category: "image",
    name: "图片调整（旋转 / 色彩 / 滤镜）",
    icon: "🎨",
    desc: "旋转翻转，调整亮度、对比度、饱和度，并可添加模糊、锐化、灰度效果。",
    accept: [IMAGE_ACCEPT],
    inputLabels: ["图片文件"],
    fields: [
      {
        key: "rotate",
        label: "旋转",
        type: "select",
        default: "none",
        options: [
          { label: "不旋转", value: "none" },
          { label: "顺时针 90°", value: "cw90" },
          { label: "逆时针 90°", value: "ccw90" },
          { label: "180°", value: "r180" },
        ],
      },
      {
        key: "flip",
        label: "翻转",
        type: "select",
        default: "none",
        options: [
          { label: "不翻转", value: "none" },
          { label: "水平翻转", value: "h" },
          { label: "垂直翻转", value: "v" },
        ],
      },
      { key: "brightness", label: "亮度", type: "range", default: 0, min: -1, max: 1, step: 0.05 },
      { key: "contrast", label: "对比度", type: "range", default: 1, min: 0, max: 2, step: 0.05 },
      { key: "saturation", label: "饱和度", type: "range", default: 1, min: 0, max: 3, step: 0.05 },
      { key: "blur", label: "高斯模糊", type: "range", default: 0, min: 0, max: 10, step: 0.5 },
      { key: "sharpen", label: "锐化", type: "checkbox", default: false },
      { key: "grayscale", label: "灰度", type: "checkbox", default: false },
      {
        key: "format",
        label: "输出格式",
        type: "select",
        default: "png",
        options: [
          { label: "PNG", value: "png" },
          { label: "JPG", value: "jpg" },
          { label: "WebP", value: "webp" },
        ],
      },
      { ...QUALITY_FIELD, visibleWhen: IMG_QUALITY_VISIBLE },
    ],
    build: ({ values, inputs }) => {
      const vf: string[] = [];
      const rot: Record<string, string> = {
        cw90: "transpose=1",
        ccw90: "transpose=2",
        r180: "transpose=1,transpose=1",
      };
      const r = rot[str(values, "rotate")];
      if (r) vf.push(r);
      if (str(values, "flip") === "h") vf.push("hflip");
      if (str(values, "flip") === "v") vf.push("vflip");

      const b = num(values, "brightness");
      const c = num(values, "contrast");
      const s = num(values, "saturation");
      if (b !== 0 || c !== 1 || s !== 1) vf.push(`eq=brightness=${b}:contrast=${c}:saturation=${s}`);

      const blur = num(values, "blur");
      if (blur > 0) vf.push(`gblur=sigma=${blur}`);
      if (values.sharpen === true) vf.push("unsharp=5:5:1.0:5:5:0.0");
      if (values.grayscale === true) vf.push("hue=s=0");

      return imageOutput(inputs[0], str(values, "format"), num(values, "quality"), vf);
    },
  },

  // ================= 图片（扩展）=================
  {
    id: "id-photo",
    category: "image",
    name: "证件照制作",
    icon: "🪪",
    desc: "自动识别并替换背景为白 / 蓝 / 红底，按标准尺寸裁剪，可限制文件大小。支持批量。",
    accept: [PHOTO_ACCEPT],
    inputLabels: ["证件照原图"],
    multiple: true,
    fields: [
      { key: "preset", label: "常用规格", type: "presets", default: "1inch-white", presets: ID_PRESETS },
      {
        key: "spec",
        label: "尺寸规格",
        type: "chips",
        default: "1inch",
        options: ID_SPECS.map((s) => ({ label: `${s.label} ${s.wMm}×${s.hMm}mm`, value: s.value })),
      },
      {
        key: "bg",
        label: "背景颜色",
        type: "chips",
        default: "white",
        options: Object.entries(ID_BG).map(([value, b]) => ({ label: b.label, value })),
      },
      {
        key: "zoom",
        label: "人像缩放",
        type: "range",
        default: 100,
        min: 100,
        max: 150,
        step: 5,
        unit: "%",
        hint: "放大人像，使头部在画面中更合适",
      },
      {
        key: "offsetY",
        label: "人物上下位置",
        type: "range",
        default: 0,
        min: -30,
        max: 30,
        step: 1,
        unit: "%",
        hint: "数值越大，人物在画面中越靠下",
      },
      {
        key: "format",
        label: "输出格式",
        type: "select",
        default: "jpg",
        options: [
          { label: "JPG（可限制文件大小）", value: "jpg" },
          { label: "PNG（无损）", value: "png" },
        ],
      },
      {
        key: "maxKB",
        label: "文件大小上限",
        type: "select",
        default: "200",
        options: [
          { label: "不限制", value: "0" },
          { label: "50 KB", value: "50" },
          { label: "100 KB", value: "100" },
          { label: "200 KB", value: "200" },
          { label: "300 KB", value: "300" },
        ],
        visibleWhen: (v) => str(v, "format") === "jpg",
        hint: "多数报名系统要求不超过 200KB",
      },
    ],
    outputHint: (values) => {
      const spec = specOf(str(values, "spec"));
      const px = specPx(spec);
      const bg = ID_BG[str(values, "bg")]?.label ?? "白底";
      return `输出 ${spec.label} ${spec.wMm}×${spec.hMm}mm · ${px.w}×${px.h} 像素（300dpi）· ${bg}`;
    },
    preprocess: (file, values) =>
      makeIdPhoto(file, {
        spec: str(values, "spec"),
        bg: str(values, "bg"),
        zoom: num(values, "zoom"),
        offsetY: num(values, "offsetY"),
        format: str(values, "format") === "png" ? "png" : "jpg",
        maxKB: Number(str(values, "maxKB")) || 0,
      }),
    // 抠图与裁剪已在前置处理中完成，这里仅做格式封装（无损复制流，避免二次编码）
    build: ({ values, inputs }) => {
      const png = str(values, "format") === "png";
      return {
        args: ["-i", inputs[0], "-frames:v", "1", "-c:v", "copy"],
        ext: png ? "png" : "jpg",
        mime: png ? "image/png" : "image/jpeg",
      };
    },
  },
  {
    id: "image-crop",
    category: "image",
    name: "图片裁剪",
    icon: "✂️",
    desc: "按比例居中裁剪，或按像素精确框选区域。支持批量。",
    accept: [IMAGE_ACCEPT],
    inputLabels: ["图片文件"],
    multiple: true,
    fields: [
      {
        key: "mode",
        label: "裁剪方式",
        type: "chips",
        default: "ratio",
        options: [
          { label: "按比例（居中）", value: "ratio" },
          { label: "按像素（自定义区域）", value: "pixel" },
        ],
      },
      {
        key: "ratio",
        label: "目标比例",
        type: "chips",
        default: "1:1",
        options: RATIO_OPTIONS.filter((o) => o.value !== "original"),
        visibleWhen: ratioMode,
      },
      { key: "x", label: "左边距 X", type: "number", default: 0, min: 0, max: 16000, unit: "px", visibleWhen: pixelMode },
      { key: "y", label: "上边距 Y", type: "number", default: 0, min: 0, max: 16000, unit: "px", visibleWhen: pixelMode },
      {
        key: "cw",
        label: "裁剪宽度",
        type: "number",
        default: 0,
        min: 0,
        max: 16000,
        unit: "px",
        hint: "0 = 延伸到右边缘",
        visibleWhen: pixelMode,
      },
      {
        key: "ch",
        label: "裁剪高度",
        type: "number",
        default: 0,
        min: 0,
        max: 16000,
        unit: "px",
        hint: "0 = 延伸到下边缘",
        visibleWhen: pixelMode,
      },
      {
        key: "format",
        label: "输出格式",
        type: "select",
        default: "png",
        options: [
          { label: "PNG（无损）", value: "png" },
          { label: "JPG", value: "jpg" },
          { label: "WebP", value: "webp" },
        ],
      },
      { ...QUALITY_FIELD, visibleWhen: IMG_QUALITY_VISIBLE },
    ],
    outputHint: (values) =>
      ratioMode(values)
        ? `按 ${str(values, "ratio")} 居中裁剪`
        : `裁剪区域：左上角 (${num(values, "x")}, ${num(values, "y")})，宽 ${num(values, "cw") || "剩余"}、高 ${num(values, "ch") || "剩余"}（px）`,
    build: ({ values, inputs }) => {
      let vf: string[] = [];
      if (pixelMode(values)) {
        const x = Math.max(0, Math.round(num(values, "x")));
        const y = Math.max(0, Math.round(num(values, "y")));
        const cw = Math.round(num(values, "cw"));
        const ch = Math.round(num(values, "ch"));
        const w = cw > 0 ? cw : `iw-${x}`;
        const h = ch > 0 ? ch : `ih-${y}`;
        vf = [`crop=w=${w}:h=${h}:x=${x}:y=${y}`];
      } else {
        const r = RATIO_MAP[str(values, "ratio")];
        if (r) vf = [cropExpr(r[0], r[1])];
      }
      return imageOutput(inputs[0], str(values, "format"), num(values, "quality"), vf);
    },
  },
  {
    id: "image-watermark",
    category: "image",
    name: "水印（文字 / 图片）",
    icon: "💧",
    desc: "为图片添加文字水印（版权声明、署名、机密标识，支持中文、多行与平铺），或图片水印（Logo、签名）。支持批量；图片水印需额外选择一张水印图。",
    accept: [IMAGE_ACCEPT, IMAGE_ACCEPT],
    inputLabels: ["主图片", "水印图片（建议 PNG 透明背景）"],
    multiple: true,
    // 文字模式只需主图；图片模式需要第二张水印图（批量时作为所有图片共享的 Logo）
    inputCount: (v) => (imageMode(v) ? 2 : 1),
    fields: [
      {
        key: "mode",
        label: "水印类型",
        type: "chips",
        default: "text",
        options: [
          { label: "文字水印", value: "text" },
          { label: "图片水印（Logo / 签名）", value: "image" },
        ],
      },
      {
        key: "preset",
        label: "常用样式",
        type: "presets",
        default: "tile-copyright",
        presets: TEXT_WM_PRESETS,
        visibleWhen: textMode,
      },
      {
        key: "text",
        label: "水印文字",
        type: "text",
        default: "© 版权所有 请勿盗用",
        hint: "支持多行，回车换行",
        visibleWhen: textMode,
      },
      {
        key: "size",
        label: "文字大小",
        type: "range",
        default: 4,
        min: 1,
        max: 30,
        step: 0.5,
        unit: "%",
        hint: "占图片宽度的比例，批量时各图自动适配",
        visibleWhen: textMode,
      },
      { key: "color", label: "文字颜色", type: "color", default: "#ffffff", visibleWhen: textMode },
      {
        key: "rotate",
        label: "旋转角度",
        type: "range",
        default: -30,
        min: -90,
        max: 90,
        step: 5,
        unit: "°",
        hint: "负数为逆时针",
        visibleWhen: textMode,
      },
      { key: "bold", label: "加粗", type: "checkbox", default: false, visibleWhen: textMode },
      {
        key: "shadow",
        label: "文字阴影（浅色背景更清晰）",
        type: "checkbox",
        default: true,
        visibleWhen: textMode,
      },
      {
        key: "position",
        label: "水印位置",
        type: "chips",
        default: "tile",
        options: TEXT_WM_POSITIONS,
        optionsFor: (v) => (textMode(v) ? TEXT_WM_POSITIONS : IMG_WM_POSITIONS),
      },
      {
        key: "wmWidth",
        label: "水印图宽度",
        type: "number",
        default: 200,
        min: 1,
        max: 8000,
        unit: "px",
        hint: "高度按比例自动计算",
        visibleWhen: imageMode,
      },
      {
        key: "opacity",
        label: "不透明度",
        type: "range",
        default: 35,
        min: 5,
        max: 100,
        step: 5,
        unit: "%",
        visibleWhen: textMode,
      },
      {
        key: "logoOpacity",
        label: "不透明度",
        type: "range",
        default: 80,
        min: 5,
        max: 100,
        step: 5,
        unit: "%",
        visibleWhen: imageMode,
      },
      {
        key: "margin",
        label: "边距",
        type: "number",
        default: 20,
        min: 0,
        max: 2000,
        unit: "px",
        visibleWhen: (v) => !["tile", "center"].includes(str(v, "position")),
      },
      {
        key: "format",
        label: "输出格式",
        type: "select",
        default: "jpg",
        options: [
          { label: "JPG", value: "jpg" },
          { label: "PNG（无损）", value: "png" },
          { label: "WebP", value: "webp" },
        ],
      },
      { ...QUALITY_FIELD, default: 92, visibleWhen: IMG_QUALITY_VISIBLE },
    ],
    outputHint: (values) => {
      if (imageMode(values)) {
        const pos = IMG_WM_POSITIONS.find((p) => p.value === str(values, "position"))?.label ?? "";
        return `图片水印 · ${pos} · 水印图宽 ${num(values, "wmWidth")}px · 不透明度 ${num(values, "logoOpacity")}%`;
      }
      const first = (str(values, "text").split("\n").find((l) => l.trim()) ?? "").trim().slice(0, 16);
      const pos = TEXT_WM_POSITIONS.find((p) => p.value === str(values, "position"))?.label ?? "";
      return `文字水印「${first || "（空）"}」· ${pos} · 字号约为图片宽度的 ${num(values, "size")}%`;
    },
    // 文字模式：Canvas 渲染透明文字图层，作为最后一个输入；图片模式无需图层
    overlay: (main, values) =>
      textMode(values)
        ? renderTextWatermark(main, {
            text: str(values, "text"),
            position: str(values, "position"),
            size: num(values, "size"),
            color: str(values, "color"),
            opacity: num(values, "opacity"),
            bold: values.bold === true,
            shadow: values.shadow === true,
            rotate: num(values, "rotate"),
          })
        : Promise.resolve(null),
    // 输入顺序：[0] 主图；[1] 文字图层（文字模式）或水印图（图片模式）
    build: ({ values, inputs }) => {
      const m = Math.max(0, Math.round(num(values, "margin")));
      const place: Record<string, string> = {
        lt: `${m}:${m}`,
        rt: `W-w-${m}:${m}`,
        lb: `${m}:H-h-${m}`,
        rb: `W-w-${m}:H-h-${m}`,
        center: "(W-w)/2:(H-h)/2",
        tile: "0:0",
      };
      const pos = place[str(values, "position")] ?? place.rb;
      const enc = encodeArgs(str(values, "format"), num(values, "quality"));

      if (textMode(values)) {
        return {
          args: [
            "-i",
            inputs[0],
            "-i",
            inputs[1],
            "-filter_complex",
            `[0:v][1:v]overlay=${pos}:format=auto[out]`,
            "-map",
            "[out]",
            ...enc.args,
          ],
          ext: enc.ext,
          mime: enc.mime,
        };
      }

      const opacity = (num(values, "logoOpacity") / 100).toFixed(2);
      const wmW = Math.max(1, Math.round(num(values, "wmWidth")));
      const fc = `[1:v]scale=${wmW}:-1,format=rgba,colorchannelmixer=aa=${opacity}[wm];[0:v][wm]overlay=${pos}:format=auto[out]`;
      return {
        args: ["-i", inputs[0], "-i", inputs[1], "-filter_complex", fc, "-map", "[out]", ...enc.args],
        ext: enc.ext,
        mime: enc.mime,
      };
    },
  },
  {
    id: "image-merge",
    category: "image",
    name: "图片拼接",
    icon: "🧩",
    desc: "把两张图片左右或上下拼接成一张图，可统一尺寸。",
    accept: [IMAGE_ACCEPT, IMAGE_ACCEPT],
    inputLabels: ["图片 1（左 / 上）", "图片 2（右 / 下）"],
    fields: [
      {
        key: "direction",
        label: "拼接方向",
        type: "chips",
        default: "h",
        options: [
          { label: "左右拼接（横向）", value: "h" },
          { label: "上下拼接（纵向）", value: "v" },
        ],
      },
      {
        key: "size",
        label: "统一尺寸",
        type: "number",
        default: 800,
        min: 16,
        max: 8000,
        unit: "px",
        hint: "横向拼接时统一高度，纵向拼接时统一宽度",
      },
      {
        key: "format",
        label: "输出格式",
        type: "select",
        default: "jpg",
        options: [
          { label: "JPG", value: "jpg" },
          { label: "PNG（无损）", value: "png" },
          { label: "WebP", value: "webp" },
        ],
      },
      { ...QUALITY_FIELD, default: 92, visibleWhen: IMG_QUALITY_VISIBLE },
    ],
    build: ({ values, inputs }) => {
      const s = Math.max(16, Math.round(num(values, "size")));
      const horizontal = str(values, "direction") === "h";
      const fc = horizontal
        ? `[0:v]scale=-2:${s}[a];[1:v]scale=-2:${s}[b];[a][b]hstack=inputs=2[out]`
        : `[0:v]scale=${s}:-2[a];[1:v]scale=${s}:-2[b];[a][b]vstack=inputs=2[out]`;
      const enc = encodeArgs(str(values, "format"), num(values, "quality"));
      return {
        args: ["-i", inputs[0], "-i", inputs[1], "-filter_complex", fc, "-map", "[out]", ...enc.args],
        ext: enc.ext,
        mime: enc.mime,
      };
    },
  },
  {
    id: "image-filter",
    category: "image",
    name: "图片滤镜风格",
    icon: "🌈",
    desc: "一键应用黑白、怀旧、复古胶片、暖色、冷色、鲜艳、反色等风格。支持批量。",
    accept: [IMAGE_ACCEPT],
    inputLabels: ["图片文件"],
    multiple: true,
    fields: [
      {
        key: "style",
        label: "滤镜风格",
        type: "chips",
        default: "bw",
        options: FILTER_STYLES.map((s) => ({ label: s.label, value: s.value })),
      },
      {
        key: "format",
        label: "输出格式",
        type: "select",
        default: "jpg",
        options: [
          { label: "JPG", value: "jpg" },
          { label: "PNG（无损）", value: "png" },
          { label: "WebP", value: "webp" },
        ],
      },
      { ...QUALITY_FIELD, default: 92, visibleWhen: IMG_QUALITY_VISIBLE },
    ],
    build: ({ values, inputs }) => {
      const style = FILTER_STYLES.find((s) => s.value === str(values, "style"));
      return imageOutput(inputs[0], str(values, "format"), num(values, "quality"), style ? [style.vf] : []);
    },
  },
  {
    id: "image-border",
    category: "image",
    name: "添加边框",
    icon: "🖼",
    desc: "给图片四周添加纯色边框（留白），适合分享、排版与证件照加边。支持批量。",
    accept: [IMAGE_ACCEPT],
    inputLabels: ["图片文件"],
    multiple: true,
    fields: [
      { key: "width", label: "边框宽度", type: "number", default: 40, min: 1, max: 1000, unit: "px" },
      {
        key: "color",
        label: "边框颜色",
        type: "chips",
        default: "white",
        options: BORDER_COLORS.map((c) => ({ label: c.label, value: c.value })),
      },
      {
        key: "format",
        label: "输出格式",
        type: "select",
        default: "png",
        options: [
          { label: "PNG（无损）", value: "png" },
          { label: "JPG", value: "jpg" },
          { label: "WebP", value: "webp" },
        ],
      },
      { ...QUALITY_FIELD, visibleWhen: IMG_QUALITY_VISIBLE },
    ],
    build: ({ values, inputs }) => {
      const b = Math.max(1, Math.round(num(values, "width")));
      const color = BORDER_COLORS.find((c) => c.value === str(values, "color")) ?? BORDER_COLORS[0];
      return imageOutput(inputs[0], str(values, "format"), num(values, "quality"), [
        `pad=w=iw+${2 * b}:h=ih+${2 * b}:x=${b}:y=${b}:color=${color.hex}`,
      ]);
    },
  },
  {
    id: "image-strip-meta",
    category: "image",
    name: "去除元数据（隐私保护）",
    icon: "🕶️",
    desc: "删除照片中的 EXIF、GPS 定位、拍摄设备等信息，画面不变。支持批量。",
    accept: [IMAGE_ACCEPT],
    inputLabels: ["图片文件"],
    multiple: true,
    fields: [
      {
        key: "format",
        label: "输出格式",
        type: "select",
        default: "jpg",
        options: [
          { label: "JPG", value: "jpg" },
          { label: "PNG", value: "png" },
          { label: "WebP", value: "webp" },
        ],
      },
      { ...QUALITY_FIELD, default: 92, visibleWhen: IMG_QUALITY_VISIBLE },
    ],
    build: ({ values, inputs }) => {
      // 重新编码输出，不复制原始元数据；同时显式清空全局与视频流元数据
      const r = imageOutput(inputs[0], str(values, "format"), num(values, "quality"));
      return { ...r, args: [...r.args, "-map_metadata", "-1", "-map_metadata:s:v:0", "-1"] };
    },
  },
];

export function getTool(id: string): ToolDef {
  return TOOLS.find((t) => t.id === id) ?? TOOLS[0];
}

const presetMatches = (p: Preset, v: Values) => Object.entries(p.values).every(([k, val]) => v[k] === val);

/** 让所有预设字段与当前参数保持一致：参数与某个预设相同则选中它，否则为"自定义" */
function syncPresets(tool: ToolDef, values: Values): Values {
  const next = { ...values };
  for (const f of tool.fields) {
    if (f.type !== "presets" || !f.presets) continue;
    const current = f.presets.find((p) => p.value === next[f.key]);
    if (current && presetMatches(current, next)) continue;
    const hit = f.presets.find((p) => presetMatches(p, next));
    next[f.key] = hit ? hit.value : "custom";
  }
  return next;
}

/** 修改单个参数后返回新的参数集（处理预设套用与自动同步） */
/** 选项随其他参数变化时（如水印类型切换），把已失效的选项修正为可用值（优先右下角，否则第一个） */
function normalizeOptions(tool: ToolDef, values: Values): Values {
  const next = { ...values };
  for (const f of tool.fields) {
    if (!f.optionsFor) continue;
    const opts = f.optionsFor(next);
    if (opts.some((o) => o.value === String(next[f.key]))) continue;
    next[f.key] = (opts.find((o) => o.value === "rb") ?? opts[0]).value;
  }
  return next;
}

export function changeValue(tool: ToolDef, values: Values, key: string, v: FieldValue): Values {
  return normalizeOptions(tool, changeValueRaw(tool, values, key, v));
}

function changeValueRaw(tool: ToolDef, values: Values, key: string, v: FieldValue): Values {
  const field = tool.fields.find((f) => f.key === key);
  if (field?.type === "presets") {
    if (v === "custom") return { ...values, [key]: v };
    const preset = field.presets?.find((p) => p.value === v);
    if (!preset) return { ...values, [key]: v };
    return syncPresets(tool, { ...values, ...preset.values, [key]: preset.value });
  }
  return syncPresets(tool, { ...values, [key]: v });
}

/**
 * 统一生成一次任务的 FFmpeg 输入文件列表：
 * 1. 第一个文件（主图）经过 preprocess（如证件照抠图），其余文件作为附加输入原样传入（如水印 Logo）；
 * 2. 若工具定义了 overlay 且返回图层，则追加在末尾（如文字水印的透明 PNG）。
 * 单文件与批量两条执行路径都通过此函数，保证行为一致。
 */
export async function prepareInputs(tool: ToolDef, files: File[], values: Values): Promise<File[]> {
  const out: File[] = [];
  for (let i = 0; i < files.length; i++) {
    out.push(i === 0 && tool.preprocess ? await tool.preprocess(files[i], values) : files[i]);
  }
  if (tool.overlay && files[0]) {
    const layer = await tool.overlay(files[0], values);
    if (layer) out.push(layer);
  }
  return out;
}

export function getDefaults(tool: ToolDef): Values {
  const out: Values = {};
  for (const f of tool.fields) out[f.key] = f.default;
  // 预设字段默认套用对应预设的全部参数
  for (const f of tool.fields) {
    if (f.type !== "presets" || !f.presets?.length) continue;
    const p = f.presets.find((x) => x.value === f.default) ?? f.presets[0];
    Object.assign(out, p.values, { [f.key]: p.value });
  }
  return out;
}
