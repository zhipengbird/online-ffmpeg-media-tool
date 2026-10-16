import type { MediaInfo } from "./ffmpeg";
import { ID_BG, ID_SPECS, makeIdPhoto, specOf, specPx } from "./idphoto";
import { renderMeme } from "./meme";
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
  type: "select" | "number" | "range" | "checkbox" | "chips" | "presets" | "text" | "color";
  default: FieldValue;
  options?: Option[];
  presets?: Preset[];
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
  inputs: string[];
  infos: (MediaInfo | null)[];
}

export interface BuildResult {
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
  accept: string[];
  inputLabels: string[];
  fields: Field[];
  build: (ctx: BuildContext) => BuildResult;
  outputHint?: (values: Values, infos?: (MediaInfo | null)[]) => string;
  multiple?: boolean;
  mergeList?: boolean;
  preprocess?: (file: File, values: Values) => Promise<File>;
  overlay?: (main: File, values: Values) => Promise<File | null>;
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
const PHOTO_ACCEPT = "image/*,.png,.jpg,.jpeg,.webp,.bmp,.gif";

/** 保证宽高为偶数（yuv420p 编码要求） */
const EVEN = "scale=trunc(iw/2)*2:trunc(ih/2)*2";
const IMAGE_EXT = /\.(png|jpe?g|webp|bmp|gif|tiff?)$/i;

const num = (v: Values, k: string, def = 0) => {
  const val = Number(v[k]);
  return Number.isFinite(val) ? val : def;
};
const str = (v: Values, k: string, def = "") => (v[k] !== undefined && v[k] !== null ? String(v[k]) : def);

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

function encodeArgs(format: string, quality: number): { ext: string; mime: string; args: string[] } {
  switch (format) {
    case "jpg":
      return {
        ext: "jpg",
        mime: "image/jpeg",
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

function imageOutput(input: string, format: string, quality: number, vf: string[] = []): BuildResult {
  const enc = encodeArgs(format, quality);
  const pre = vf.length ? ["-vf", vf.join(",")] : [];
  return { ext: enc.ext, mime: enc.mime, args: ["-i", input, ...pre, ...enc.args] };
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

function cropExpr(rw: number, rh: number): string {
  return `crop=w='min(iw,ih*${rw}/${rh})':h='min(ih,iw*${rh}/${rw})'`;
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
  default: 82,
  min: 1,
  max: 100,
  hint: "仅对 JPG / WebP 有效",
};

const IMG_QUALITY_VISIBLE = (v: Values) => ["jpg", "webp"].includes(str(v, "format"));

const ID_PRESETS: Preset[] = [
  {
    value: "1inch-white",
    label: "一寸白底",
    hint: "25×35mm · 单张电子版",
    values: { spec: "1inch", bg: "white", layout: "single", cutline: true, format: "jpg", maxKB: "200", zoom: 100, offsetY: 0 },
  },
  {
    value: "1inch-blue",
    label: "一寸蓝底",
    hint: "25×35mm · 单张电子版",
    values: { spec: "1inch", bg: "blue", layout: "single", cutline: true, format: "jpg", maxKB: "200", zoom: 100, offsetY: 0 },
  },
  {
    value: "1inch-red",
    label: "一寸红底",
    hint: "25×35mm · 单张电子版",
    values: { spec: "1inch", bg: "red", layout: "single", cutline: true, format: "jpg", maxKB: "200", zoom: 100, offsetY: 0 },
  },
  {
    value: "2inch-white",
    label: "二寸白底",
    hint: "35×49mm · 单张电子版",
    values: { spec: "2inch", bg: "white", layout: "single", cutline: true, format: "jpg", maxKB: "200", zoom: 100, offsetY: 0 },
  },
  {
    value: "2inch-red",
    label: "二寸红底",
    hint: "35×49mm · 单张电子版",
    values: { spec: "2inch", bg: "red", layout: "single", cutline: true, format: "jpg", maxKB: "200", zoom: 100, offsetY: 0 },
  },
  {
    value: "passport",
    label: "护照白底",
    hint: "33×48mm · 单张电子版",
    values: { spec: "passport", bg: "white", layout: "single", cutline: true, format: "jpg", maxKB: "200", zoom: 100, offsetY: 0 },
  },
  {
    value: "1inch-gray",
    label: "一寸高级灰",
    hint: "25×35mm · 商务形象标准",
    values: { spec: "1inch", bg: "gray", layout: "single", cutline: true, format: "jpg", maxKB: "200", zoom: 100, offsetY: 0 },
  },
  {
    value: "1inch-print6",
    label: "一寸6寸相纸",
    hint: "10张冲印排版 · 带裁切线",
    values: { spec: "1inch", bg: "white", layout: "print6", cutline: true, format: "jpg", maxKB: "0", zoom: 100, offsetY: 0 },
  },
];

const FILTER_STYLES: { value: string; label: string; vf: string }[] = [
  { value: "bw", label: "黑白经典", vf: "hue=s=0" },
  { value: "sepia", label: "怀旧复古", vf: "colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131" },
  { value: "vintage", label: "胶片风格", vf: "curves=preset=vintage" },
  { value: "warm", label: "暖色调", vf: "colorbalance=rs=0.15:gs=0.05:bs=-0.15" },
  { value: "cool", label: "冷色调", vf: "colorbalance=rs=-0.15:bs=0.15" },
  { value: "vivid", label: "鲜艳高饱和", vf: "eq=saturation=1.6:contrast=1.1" },
  { value: "invert", label: "反色胶片", vf: "negate" },
];

const textMode = (v: Values) => str(v, "mode") !== "image";
const imageMode = (v: Values) => str(v, "mode") === "image";

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
];

const VIDEO_TRANSCODE_PRESETS: Preset[] = [
  {
    value: "original",
    label: "保持原画",
    hint: "原尺寸 · CRF 22 · MP4",
    values: { format: "mp4", crf: 22, scale: "0", mute: false },
  },
  {
    value: "balanced",
    label: "标准压缩",
    hint: "720p · CRF 26 · 兼顾画质体积",
    values: { format: "mp4", crf: 26, scale: "720", mute: false },
  },
  {
    value: "hd",
    label: "高清压制",
    hint: "1080p · CRF 23 · 高清晰度",
    values: { format: "mp4", crf: 23, scale: "1080", mute: false },
  },
  {
    value: "small",
    label: "极小体积",
    hint: "480p · CRF 30 · 便于网络传输",
    values: { format: "mp4", crf: 30, scale: "480", mute: false },
  },
  {
    value: "webm-share",
    label: "WebM 网页分享",
    hint: "720p · VP9 编码 · WebM 格式",
    values: { format: "webm", crf: 28, scale: "720", mute: false },
  },
];

const IMAGE_STUDIO_PRESETS: Preset[] = [
  {
    value: "social",
    label: "社交媒体分享",
    hint: "限制宽 1080 · JPG 82 · 清除隐私",
    values: { format: "jpg", quality: 82, maxWidth: "1080", rotate: "none", filter: "none", stripMeta: true },
  },
  {
    value: "web",
    label: "网站配图（WebP）",
    hint: "限制宽 1200 · WebP 80 · 高效体积",
    values: { format: "webp", quality: 80, maxWidth: "1200", rotate: "none", filter: "none", stripMeta: true },
  },
  {
    value: "mail",
    label: "邮件小体积附件",
    hint: "限制宽 800 · JPG 68 · 极小尺寸",
    values: { format: "jpg", quality: 68, maxWidth: "800", rotate: "none", filter: "none", stripMeta: true },
  },
  {
    value: "lossless",
    label: "无损原图备份",
    hint: "保持原尺寸 · PNG 无损格式",
    values: { format: "png", quality: 90, maxWidth: "0", rotate: "none", filter: "none", stripMeta: false },
  },
  {
    value: "vintage-share",
    label: "胶片文艺分享",
    hint: "限制宽 1440 · 胶片调色 · JPG 88",
    values: { format: "jpg", quality: 88, maxWidth: "1440", rotate: "none", filter: "vintage", stripMeta: true },
  },
];

/* =========================================================================
   CONSOLIDATED TOOLS MATRIX (23 项精简合并为 14 项场景化超级工具)
========================================================================= */

export const TOOLS: ToolDef[] = [
  // ================= 1. 视频转码与压制 (合并 格式转换 + 视频压缩 + 分辨率调整 + 去除音轨) =================
  {
    id: "video-transcode",
    category: "video",
    name: "视频转码与压制",
    icon: "🎬",
    desc: "格式转换（MP4/WebM/MOV/MKV/AVI）、画质压缩、分辨率缩放与静音处理一站式完成。支持多视频文件批量压制。",
    accept: [VIDEO_ACCEPT],
    inputLabels: ["视频文件"],
    multiple: true,
    fields: [
      { key: "preset", label: "常用预设", type: "presets", default: "balanced", presets: VIDEO_TRANSCODE_PRESETS },
      {
        key: "format",
        label: "输出格式",
        type: "select",
        default: "mp4",
        options: [
          { label: "MP4 (H.264 + AAC)", value: "mp4" },
          { label: "WebM (VP9 + Opus)", value: "webm" },
          { label: "MOV (Apple QuickTime)", value: "mov" },
          { label: "MKV (Matroska)", value: "mkv" },
          { label: "AVI (MPEG-4)", value: "avi" },
          { label: "FLV (Flash)", value: "flv" },
        ],
      },
      {
        key: "crf",
        label: "压缩画质 (CRF)",
        type: "range",
        default: 23,
        min: 16,
        max: 40,
        hint: "数值越小画质越好、文件越大；推荐 20~28",
      },
      {
        key: "scale",
        label: "输出分辨率",
        type: "select",
        default: "720",
        options: [
          { label: "保持原始分辨率", value: "0" },
          { label: "1080p (1920×1080)", value: "1080" },
          { label: "720p (1280×720)", value: "720" },
          { label: "480p (854×480)", value: "480" },
          { label: "360p (640×360)", value: "360" },
          { label: "自定义宽度与高度", value: "custom" },
        ],
      },
      {
        key: "customW",
        label: "自定义宽度 (px)",
        type: "number",
        default: 0,
        min: 0,
        max: 7680,
        hint: "0 = 自动按原比例推算",
        visibleWhen: (v) => str(v, "scale") === "custom",
      },
      {
        key: "customH",
        label: "自定义高度 (px)",
        type: "number",
        default: 720,
        min: 0,
        max: 4320,
        hint: "0 = 自动按原比例推算",
        visibleWhen: (v) => str(v, "scale") === "custom",
      },
      {
        key: "mute",
        label: "去除音频轨道（静音视频）",
        type: "checkbox",
        default: false,
      },
    ],
    outputHint: (values) => {
      const scaleStr =
        str(values, "scale") === "custom"
          ? `${num(values, "customW") || "自适应"}×${num(values, "customH") || "自适应"}`
          : str(values, "scale") === "0"
            ? "保持原始分辨率"
            : `${str(values, "scale")}p 标清/高清`;
      const muteStr = values.mute === true ? " · 静音无声" : "";
      return `${str(values, "format").toUpperCase()} 格式 · CRF ${num(values, "crf")} · ${scaleStr}${muteStr}`;
    },
    build: ({ values, inputs }) => {
      const crf = num(values, "crf");
      const fmt = str(values, "format");
      const scaleMode = str(values, "scale");
      const filters: string[] = [];

      if (scaleMode === "custom") {
        const w = num(values, "customW");
        const h = num(values, "customH");
        filters.push(`scale=${w > 0 ? Math.round(w) : -2}:${h > 0 ? Math.round(h) : -2}`);
      } else if (scaleMode !== "0") {
        filters.push(`scale=-2:${scaleMode}`);
      }
      filters.push(EVEN);

      const c = videoContainer(fmt, crf);

      return {
        args: [
          "-i",
          inputs[0],
          "-vf",
          filters.join(","),
          ...(values.mute === true ? ["-an", ...c.args.filter((a) => !a.startsWith("-c:a") && !a.startsWith("-b:a") && a !== "aac" && a !== "libopus" && a !== "libmp3lame")] : c.args),
        ],
        ext: c.ext,
        mime: c.mime,
      };
    },
  },

  // ================= 2. 视频剪辑与调速 (合并 剪切 + 变速 + 旋转翻转) =================
  {
    id: "video-edit",
    category: "video",
    name: "视频剪辑与调速",
    icon: "✂️",
    desc: "截取片段、变速（0.25x~4x）及画面旋转/翻转一条龙处理，音视频自动同步。",
    accept: [VIDEO_ACCEPT],
    inputLabels: ["视频文件"],
    fields: [
      TIME_FIELD("start", "开始时间", 0, "0 = 从开头开始"),
      TIME_FIELD("end", "结束时间", 0, "0 = 截取到视频末尾"),
      {
        key: "speed",
        label: "播放速度",
        type: "chips",
        default: "1",
        options: [
          { label: "0.25x 极慢", value: "0.25" },
          { label: "0.5x 慢放", value: "0.5" },
          { label: "0.75x", value: "0.75" },
          { label: "1x 正常", value: "1" },
          { label: "1.25x", value: "1.25" },
          { label: "1.5x 快进", value: "1.5" },
          { label: "2x 双倍", value: "2" },
          { label: "4x 极快", value: "4" },
        ],
      },
      {
        key: "transform",
        label: "画面旋转与镜像",
        type: "select",
        default: "none",
        options: [
          { label: "保持原方向", value: "none" },
          { label: "顺时针旋转 90°", value: "cw90" },
          { label: "逆时针旋转 90°", value: "ccw90" },
          { label: "旋转 180°", value: "r180" },
          { label: "水平镜像翻转", value: "hflip" },
          { label: "垂直翻转", value: "vflip" },
        ],
      },
    ],
    outputHint: (values) => {
      const sp = str(values, "speed");
      const rot = str(values, "transform");
      const rotMap: Record<string, string> = {
        hflip: " · 水平镜像翻转",
        vflip: " · 垂直翻转",
        cw90: " · 顺时针旋转90°",
        ccw90: " · 逆时针旋转90°",
        r180: " · 旋转180°",
      };
      const rotStr = rot !== "none" ? (rotMap[rot] ?? "") : "";
      return `MP4 格式 · ${sp}x 倍速${rotStr} · 帧精确重编码`;
    },
    build: ({ values, inputs, infos }) => {
      const start = num(values, "start");
      const end = num(values, "end");
      const duration = infos[0]?.duration ?? 0;
      let dur: number | null = null;
      if (end > 0) {
        if (end <= start) throw new Error("结束时间必须大于开始时间");
        dur = end - start;
      } else if (duration > 0 && duration > start) {
        dur = duration - start;
      }

      const sp = Number(str(values, "speed")) || 1;
      const vFilters: string[] = [`setpts=PTS/${sp}`];

      const rotMap: Record<string, string> = {
        cw90: "transpose=1",
        ccw90: "transpose=2",
        r180: "transpose=1,transpose=1",
        hflip: "hflip",
        vflip: "vflip",
      };
      const tr = rotMap[str(values, "transform")];
      if (tr) vFilters.push(tr);
      vFilters.push(EVEN);

      const hasAudio = infos[0]?.hasAudio === true;
      const args: string[] = ["-ss", String(start), "-i", inputs[0]];
      if (dur !== null) args.push("-t", dur.toFixed(3));

      if (!hasAudio) {
        args.push("-vf", vFilters.join(","), ...X264(22), "-movflags", "+faststart");
      } else {
        const aFilters = atempoChain(sp);
        args.push("-vf", vFilters.join(","), "-af", aFilters, ...X264(22), ...AAC(), "-movflags", "+faststart");
      }

      return { args, ext: "mp4", mime: "video/mp4" };
    },
  },

  // ================= 3. 视频转 GIF =================
  {
    id: "video-gif",
    category: "video",
    name: "视频转 GIF 动图",
    icon: "🎞️",
    desc: "截取视频片段并使用高质量双通道调色板算法生成平滑 GIF 动图。",
    accept: [VIDEO_ACCEPT],
    inputLabels: ["视频文件"],
    fields: [
      TIME_FIELD("start", "开始时间", 0),
      TIME_FIELD("duration", "持续时长", 5, "0 = 整个视频（可能很大）"),
      { key: "fps", label: "帧率 (FPS)", type: "range", default: 12, min: 1, max: 30, hint: "越高越流畅、体积越大" },
      { key: "width", label: "输出宽度", type: "number", default: 480, min: 16, max: 1920, unit: "px", hint: "高度按比例自动计算" },
      {
        key: "loopMode",
        label: "循环模式",
        type: "chips",
        default: "infinite",
        options: [
          { label: "无限循环 (标准)", value: "infinite" },
          { label: "乒乓反弹 (正放+倒放)", value: "boomerang" },
          { label: "单次播放", value: "once" },
        ],
      },
    ],
    outputHint: (values) => {
      const mode = str(values, "loopMode");
      const modeLabel = mode === "boomerang" ? " · 乒乓反弹动效" : mode === "once" ? " · 仅播一次" : " · 无限循环";
      return `输出 GIF：${Math.round(num(values, "width"))}px 宽 · ${num(values, "fps")} FPS${modeLabel}`;
    },
    build: ({ values, inputs }) => {
      const start = num(values, "start");
      const dur = num(values, "duration");
      const fps = num(values, "fps");
      const width = Math.round(num(values, "width"));
      const loopMode = str(values, "loopMode");

      const args = ["-ss", String(start)];
      if (dur > 0) args.push("-t", String(dur));
      args.push("-i", inputs[0]);

      let vf: string;
      if (loopMode === "boomerang") {
        vf = `fps=${fps},scale=${width}:-1:flags=lanczos[base];[base]split[f][r];[r]reverse[rr];[f][rr]concat=n=2:v=1[merged];[merged]split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer`;
      } else {
        vf = `fps=${fps},scale=${width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer`;
      }

      args.push("-vf", vf);
      const loopArg = loopMode === "once" ? "-1" : "0";
      args.push("-loop", loopArg);

      return { args, ext: "gif", mime: "image/gif" };
    },
  },

  // ================= 4. 视频抽帧 / 联系表 =================
  {
    id: "video-frame",
    category: "video",
    name: "视频抽帧 / 联系表",
    icon: "📸",
    desc: "截取单帧封面，或按时间间隔生成多帧联系表，适合选封面、审片和快速查看关键画面。",
    accept: [VIDEO_ACCEPT],
    inputLabels: ["视频文件"],
    fields: [
      {
        key: "mode",
        label: "抽帧方式",
        type: "chips",
        default: "single",
        options: [
          { label: "单帧封面", value: "single" },
          { label: "多帧联系表", value: "contact" },
        ],
      },
      { ...TIME_FIELD("time", "截取时间点", 1), visibleWhen: (v) => str(v, "mode") === "single" },
      {
        key: "interval",
        label: "抽帧间隔",
        type: "number",
        default: 2,
        min: 0.1,
        max: 60,
        step: 0.1,
        unit: "秒",
        visibleWhen: (v) => str(v, "mode") === "contact",
      },
      {
        key: "count",
        label: "最多帧数",
        type: "number",
        default: 6,
        min: 2,
        max: 30,
        step: 1,
        unit: "帧",
        visibleWhen: (v) => str(v, "mode") === "contact",
      },
      {
        key: "thumbWidth",
        label: "单帧宽度",
        type: "number",
        default: 320,
        min: 120,
        max: 800,
        step: 10,
        unit: "px",
        visibleWhen: (v) => str(v, "mode") === "contact",
      },
      {
        key: "format",
        label: "图片格式",
        type: "select",
        default: "png",
        options: [
          { label: "PNG（无损）", value: "png" },
          { label: "JPG（轻量）", value: "jpg" },
          { label: "WebP", value: "webp" },
        ],
      },
    ],
    build: ({ values, inputs }) => {
      const fmt = str(values, "format");
      if (str(values, "mode") === "contact") {
        const interval = Math.max(0.1, Math.min(60, num(values, "interval", 2)));
        const count = Math.max(2, Math.min(30, Math.round(num(values, "count", 6))));
        const thumbWidth = Math.max(120, Math.min(800, Math.round(num(values, "thumbWidth", 320))));
        const cols = Math.ceil(Math.sqrt(count));
        const rows = Math.ceil(count / cols);
        const vf = `fps=1/${interval},select='lte(n\\,${count - 1})',scale=${thumbWidth}:-2:flags=lanczos,tile=${cols}x${rows}:padding=8:margin=8:color=white`;
        const outputArgs =
          fmt === "jpg"
            ? ["-frames:v", "1", "-q:v", "2"]
            : fmt === "webp"
              ? ["-frames:v", "1", "-c:v", "libwebp", "-quality", "90"]
              : ["-frames:v", "1"];
        return {
          args: ["-i", inputs[0], "-vf", vf, ...outputArgs],
          ext: fmt === "jpg" ? "jpg" : fmt === "webp" ? "webp" : "png",
          mime: fmt === "jpg" ? "image/jpeg" : fmt === "webp" ? "image/webp" : "image/png",
        };
      }
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

  // ================= 5. 音视频合并（替换音轨）=================
  {
    id: "video-merge-av",
    category: "video",
    name: "视频配乐 / 替换音轨",
    icon: "🎵",
    desc: "将音频文件作为新音轨合并到视频中，支持无损替换并按短者自动裁切。",
    accept: [VIDEO_ACCEPT, AUDIO_ACCEPT],
    inputLabels: ["视频文件（画面）", "音频文件（新配乐）"],
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

  // ================= 6. 图片动态封面视频 =================
  {
    id: "video-img2vid",
    category: "video",
    name: "图片动态封面视频",
    icon: "📦",
    desc: "按顺序将多张图片制作成适合短视频发布的 MP4，支持平移推拉、色彩风格、滑动转场和背景音乐。",
    accept: [IMAGE_ACCEPT, AUDIO_ACCEPT],
    inputLabels: ["图片文件", "背景音乐（可选）"],
    mergeList: true,
    fields: [
      { key: "duration", label: "视频时长", type: "number", default: 5, min: 0.1, max: 3600, step: 0.5, unit: "秒" },
      { key: "fps", label: "帧率 (FPS)", type: "number", default: 25, min: 1, max: 60 },
      {
        key: "canvas",
        label: "视频画幅",
        type: "select",
        default: "original",
        options: [
          { label: "保持原图比例", value: "original" },
          { label: "横屏 16:9（1280×720）", value: "landscape" },
          { label: "竖屏 9:16（720×1280）", value: "portrait" },
          { label: "正方形 1:1（1080×1080）", value: "square" },
        ],
      },
      {
        key: "fit",
        label: "画面适配",
        type: "chips",
        default: "cover",
        options: [
          { label: "铺满画面（裁切）", value: "cover" },
          { label: "完整显示（留黑边）", value: "contain" },
        ],
        visibleWhen: (v) => str(v, "canvas") !== "original",
      },
      {
        key: "motion",
        label: "动态效果",
        type: "chips",
        default: "none",
        options: [
          { label: "静止画面", value: "none" },
          { label: "缓慢放大", value: "zoom-in" },
          { label: "缓慢缩小", value: "zoom-out" },
          { label: "向左平移", value: "pan-left" },
          { label: "向右平移", value: "pan-right" },
          { label: "向上平移", value: "pan-up" },
          { label: "向下平移", value: "pan-down" },
        ],
      },
      {
        key: "style",
        label: "画面风格",
        type: "chips",
        default: "original",
        options: [
          { label: "原图色彩", value: "original" },
          { label: "鲜艳增强", value: "vivid" },
          { label: "黑白", value: "grayscale" },
          { label: "暖调", value: "warm" },
          { label: "冷调", value: "cool" },
          { label: "复古棕褐", value: "sepia" },
        ],
      },
      {
        key: "transition",
        label: "图片转场",
        type: "chips",
        default: "cut",
        options: [
          { label: "直接切换", value: "cut" },
          { label: "淡入淡出", value: "fade" },
          { label: "向左滑动", value: "slideleft" },
          { label: "向右滑动", value: "slideright" },
          { label: "向左擦除", value: "wipeleft" },
          { label: "向右擦除", value: "wiperight" },
          { label: "圆形展开", value: "circleopen" },
        ],
      },
      {
        key: "soundtrack",
        label: "背景音乐",
        type: "chips",
        default: "none",
        options: [
          { label: "不添加", value: "none" },
          { label: "添加音频", value: "audio" },
        ],
      },
      {
        key: "audioBitrate",
        label: "音频码率",
        type: "select",
        default: "128k",
        options: [
          { label: "96 kbps", value: "96k" },
          { label: "128 kbps", value: "128k" },
          { label: "192 kbps", value: "192k" },
        ],
        visibleWhen: (v) => str(v, "soundtrack") === "audio",
      },
    ],
    inputCount: (v) => (str(v, "soundtrack") === "audio" ? 2 : 1),
    outputHint: (values) => {
      const canvas = str(values, "canvas");
      const canvasText = canvas === "landscape" ? "横屏 16:9" : canvas === "portrait" ? "竖屏 9:16" : canvas === "square" ? "正方形" : "原图比例";
      const motion = str(values, "motion");
      const motionText =
        motion === "zoom-in"
          ? " · 缓慢放大"
          : motion === "zoom-out"
            ? " · 缓慢缩小"
            : motion === "pan-left"
              ? " · 向左平移"
              : motion === "pan-right"
                ? " · 向右平移"
                : motion === "pan-up"
                  ? " · 向上平移"
                  : motion === "pan-down"
                    ? " · 向下平移"
                    : "";
      const styleText =
        str(values, "style") === "vivid"
          ? " · 鲜艳增强"
          : str(values, "style") === "grayscale"
            ? " · 黑白"
            : str(values, "style") === "warm"
              ? " · 暖调"
              : str(values, "style") === "cool"
                ? " · 冷调"
                : str(values, "style") === "sepia"
                  ? " · 复古棕褐"
                  : "";
      const transitionText =
        str(values, "transition") === "fade"
          ? " · 淡入淡出"
          : str(values, "transition") === "slideleft"
            ? " · 向左滑动"
            : str(values, "transition") === "slideright"
              ? " · 向右滑动"
              : str(values, "transition") === "wipeleft"
                ? " · 向左擦除"
                : str(values, "transition") === "wiperight"
                  ? " · 向右擦除"
                  : str(values, "transition") === "circleopen"
                    ? " · 圆形展开"
                    : "";
      const audioText = str(values, "soundtrack") === "audio" ? " · 配背景音乐" : "";
      return `MP4 · 每张 ${num(values, "duration")} 秒 · ${canvasText}${motionText}${styleText}${transitionText}${audioText}`;
    },
    build: ({ values, inputs }) => {
      const hasAudio = str(values, "soundtrack") === "audio";
      const imageInputs = hasAudio ? inputs.slice(0, -1) : inputs;
      const audioInput = hasAudio ? inputs[inputs.length - 1] : undefined;
      if (imageInputs.length < 1) {
        throw new Error("图片动态封面视频至少需要 1 张图片");
      }
      if (imageInputs.some((input) => !IMAGE_EXT.test(input))) {
        throw new Error("图片动态封面视频只接受图片文件作为输入（PNG / JPG / WebP / BMP / GIF / TIFF）");
      }
      if (hasAudio && !audioInput) throw new Error("已选择添加背景音乐，请先选择音频文件");
      const duration = Math.max(0.1, Math.min(3600, num(values, "duration", 5)));
      const fps = Math.max(1, Math.min(60, Math.round(num(values, "fps", 25))));
      const canvas = str(values, "canvas");
      const sourceW = 1280;
      const sourceH = 720;
      const dimensions =
        canvas === "landscape"
          ? { w: 1280, h: 720 }
          : canvas === "portrait"
            ? { w: 720, h: 1280 }
            : canvas === "square"
              ? { w: 1080, h: 1080 }
              : { w: sourceW - (sourceW % 2), h: sourceH - (sourceH % 2) };
      const fit = str(values, "fit") === "contain" ? "contain" : "cover";
      const baseFilter =
        canvas === "original" && imageInputs.length === 1
          ? EVEN
          : fit === "contain"
            ? `scale=${dimensions.w}:${dimensions.h}:force_original_aspect_ratio=decrease,pad=${dimensions.w}:${dimensions.h}:(ow-iw)/2:(oh-ih)/2:color=black`
            : `scale=${dimensions.w}:${dimensions.h}:force_original_aspect_ratio=increase,crop=${dimensions.w}:${dimensions.h}`;
      const motion = str(values, "motion");
      const frames = Math.max(1, Math.round(duration * fps));
      const panFrames = Math.max(1, frames - 1);
      const motionFilter = (motionValue: string) => {
        if (motionValue === "zoom-in") return `,zoompan=z='min(zoom+0.0015,1.2)':d=${frames}:s=${dimensions.w}x${dimensions.h}:fps=${fps}`;
        if (motionValue === "zoom-out") return `,zoompan=z='if(eq(on,0),1.2,max(zoom-0.0015,1))':d=${frames}:s=${dimensions.w}x${dimensions.h}:fps=${fps}`;
        const panDirection = motionValue.replace("pan-", "");
        if (["left", "right", "up", "down"].includes(panDirection)) {
          const cropX = panDirection === "left" ? `(iw-ow)*(1-n/${panFrames})` : panDirection === "right" ? `(iw-ow)*n/${panFrames}` : `(iw-ow)/2`;
          const cropY = panDirection === "up" ? `(ih-oh)*(1-n/${panFrames})` : panDirection === "down" ? `(ih-oh)*n/${panFrames}` : `(ih-oh)/2`;
          return `,crop=w='iw*0.88':h='ih*0.88':x='${cropX}':y='${cropY}',scale=${dimensions.w}:${dimensions.h}:flags=lanczos`;
        }
        return "";
      };
      const style = str(values, "style");
      const styleFilter =
        style === "vivid"
          ? ",eq=contrast=1.08:saturation=1.35"
          : style === "grayscale"
            ? ",hue=s=0"
            : style === "warm"
              ? ",colorbalance=rs=0.08:gs=0.02:bs=-0.08"
              : style === "cool"
                ? ",colorbalance=rs=-0.08:gs=0.02:bs=0.08"
                : style === "sepia"
                  ? ",colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131"
                  : "";
      const selectedTransition = str(values, "transition");
      const transition = selectedTransition !== "cut" && imageInputs.length > 1 ? selectedTransition : "cut";
      const transitionDuration = Math.min(0.5, duration / 2);
      const filterParts: string[] = [];
      const segmentLabels: string[] = [];
      for (let i = 0; i < imageInputs.length; i++) {
        const label = `v${i}`;
        filterParts.push(`[${i}:v]${baseFilter}${motionFilter(motion)}${styleFilter},trim=duration=${duration},setpts=PTS-STARTPTS[${label}]`);
        segmentLabels.push(`[${label}]`);
      }

      let outputLabel = "outv";
      if (transition !== "cut") {
        let current = segmentLabels[0];
        for (let i = 1; i < segmentLabels.length; i++) {
          const next = `x${i}`;
          const offset = (i * (duration - transitionDuration)).toFixed(3);
          filterParts.push(`${current}${segmentLabels[i]}xfade=transition=${transition}:duration=${transitionDuration}:offset=${offset}[${next}]`);
          current = `[${next}]`;
        }
        filterParts.push(`${current}format=yuv420p[${outputLabel}]`);
      } else {
        filterParts.push(`${segmentLabels.join("")}concat=n=${segmentLabels.length}:v=1:a=0,format=yuv420p[${outputLabel}]`);
      }

      const args: string[] = [];
      for (const input of imageInputs) args.push("-loop", "1", "-i", input);
      if (hasAudio && audioInput) args.push("-i", audioInput);
      const totalDuration = imageInputs.length * duration - (imageInputs.length - 1) * (transition !== "cut" ? transitionDuration : 0);
      args.push("-filter_complex", filterParts.join(";"), "-map", `[${outputLabel}]`, "-t", totalDuration.toFixed(3), "-r", String(fps), ...X264(23));
      if (hasAudio) {
        args.push("-map", `${imageInputs.length}:a:0`, ...AAC(str(values, "audioBitrate", "128k")), "-shortest");
      } else {
        args.push("-an");
      }
      args.push("-movflags", "+faststart");
      return {
        args,
        ext: "mp4",
        mime: "video/mp4",
      };
    },
  },

  // ================= 7. 全能音频工坊 (合并 格式转换 + 音量 + 剪切 + 淡入淡出) =================
  {
    id: "audio-studio",
    category: "audio",
    name: "全能音频工坊",
    icon: "🎧",
    desc: "音频格式转换、提取音轨、起止剪辑、音量调节（50%~300%）与淡入淡出一体化处理。支持批量处理。",
    accept: [MEDIA_ACCEPT],
    inputLabels: ["音频或视频文件"],
    multiple: true,
    fields: [
      {
        key: "format",
        label: "输出格式",
        type: "select",
        default: "mp3",
        options: [
          { label: "MP3 (通用高兼容)", value: "mp3" },
          { label: "M4A (AAC 高清)", value: "m4a" },
          { label: "WAV (无损母带级)", value: "wav" },
          { label: "FLAC (无损压缩)", value: "flac" },
          { label: "OGG (Vorbis)", value: "ogg" },
          { label: "OPUS (语音低延迟)", value: "opus" },
        ],
      },
      {
        key: "bitrate",
        label: "音频码率",
        type: "chips",
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
      TIME_FIELD("start", "开始时间", 0, "0 = 从开头开始"),
      TIME_FIELD("end", "结束时间", 0, "0 = 截取到结尾"),
      {
        key: "speed",
        label: "播放倍速",
        type: "chips",
        default: "1",
        options: [
          { label: "0.5x 慢放", value: "0.5" },
          { label: "0.75x", value: "0.75" },
          { label: "1x 原速", value: "1" },
          { label: "1.25x 快放", value: "1.25" },
          { label: "1.5x", value: "1.5" },
          { label: "2x 双倍", value: "2" },
        ],
      },
      {
        key: "volume",
        label: "音量增益",
        type: "select",
        default: "1",
        options: [
          { label: "50% (减半)", value: "0.5" },
          { label: "80%", value: "0.8" },
          { label: "100% (原始音量)", value: "1" },
          { label: "120%", value: "1.2" },
          { label: "150% (放大)", value: "1.5" },
          { label: "200% (翻倍)", value: "2" },
          { label: "300%", value: "3" },
        ],
      },
      TIME_FIELD("fadeIn", "淡入时长", 0, "0 = 无淡入"),
      TIME_FIELD("fadeOut", "淡出时长", 0, "0 = 无淡出"),
    ],
    outputHint: (values) => {
      const vol = num(values, "volume");
      const volStr = vol !== 1 ? ` · 音量 ${Math.round(vol * 100)}%` : "";
      const sp = Number(str(values, "speed")) || 1;
      const spStr = sp !== 1 ? ` · ${sp}x 变速` : "";
      return `${str(values, "format").toUpperCase()} 格式 · 码率 ${str(values, "bitrate")}${volStr}${spStr}`;
    },
    build: ({ values, inputs, infos }) => {
      const start = num(values, "start");
      const end = num(values, "end");
      const duration = infos[0]?.duration ?? 0;
      let dur: number | null = null;
      if (end > 0) {
        if (end <= start) throw new Error("结束时间必须大于开始时间");
        dur = end - start;
      } else if (duration > 0 && duration > start) {
        dur = duration - start;
      }

      const filters: string[] = [];
      const sp = Number(str(values, "speed")) || 1;
      if (sp !== 1) {
        filters.push(atempoChain(sp));
      }

      const vol = num(values, "volume");
      if (vol !== 1) filters.push(`volume=${vol}`);

      const fadeIn = num(values, "fadeIn");
      if (fadeIn > 0) filters.push(`afade=t=in:st=0:d=${fadeIn}`);

      const fadeOut = num(values, "fadeOut");
      if (fadeOut > 0) {
        if (dur === null) throw new Error("设置淡出效果需要明确结束时间或源文件包含时长信息");
        const actualDur = dur / sp;
        filters.push(`afade=t=out:st=${Math.max(0, actualDur - fadeOut).toFixed(3)}:d=${fadeOut}`);
      }

      const args = ["-ss", String(start), "-i", inputs[0]];
      if (dur !== null) args.push("-t", dur.toFixed(3));
      if (filters.length) args.push("-af", filters.join(","));

      const enc = audioEncoder(str(values, "format"), str(values, "bitrate"));
      args.push("-vn", ...enc.args);

      return { args, ext: enc.ext, mime: enc.mime };
    },
  },

  // ================= 8. 全能图片工坊 (合并 转换 + 压缩 + 调色旋转 + 滤镜 + 边框 + 清除隐私) =================
  {
    id: "image-studio",
    category: "image",
    name: "图片编辑器 / 全能图片工坊",
    icon: "🖼️",
    desc: "图片格式、压缩、尺寸、旋转、滤镜与隐私信息一站式编辑处理，支持批量。",
    multiple: true,
    accept: [IMAGE_ACCEPT],
    inputLabels: ["图片文件"],
    fields: [
      { key: "preset", label: "常用预设", type: "presets", default: "social", presets: IMAGE_STUDIO_PRESETS },
      {
        key: "format",
        label: "输出格式",
        type: "select",
        default: "jpg",
        options: [
          { label: "JPG (通用体积小)", value: "jpg" },
          { label: "WebP (现代高效格式)", value: "webp" },
          { label: "PNG (无损透明通道)", value: "png" },
          { label: "GIF (静态动图容器)", value: "gif" },
          { label: "BMP (位图)", value: "bmp" },
        ],
      },
      { ...QUALITY_FIELD, visibleWhen: IMG_QUALITY_VISIBLE },
      {
        key: "maxWidth",
        label: "尺寸缩放调整",
        type: "select",
        default: "1080",
        options: [
          { label: "保持原图尺寸 (不缩放)", value: "0" },
          { label: "限制 2560px (2K 超清)", value: "2560" },
          { label: "限制 1920px (1080P 全高清)", value: "1920" },
          { label: "限制 1200px (网页配图)", value: "1200" },
          { label: "限制 1080px (微信/社交配图推荐)", value: "1080" },
          { label: "限制 800px (邮件/缩略图)", value: "800" },
          { label: "🎯 自定义精确宽高像素", value: "custom" },
        ],
      },
      {
        key: "customWidth",
        label: "目标宽度 (px)",
        type: "number",
        default: 800,
        min: 0,
        max: 8000,
        unit: "px",
        hint: "0 = 自动按高度等比缩放",
        visibleWhen: (v) => str(v, "maxWidth") === "custom",
      },
      {
        key: "customHeight",
        label: "目标高度 (px)",
        type: "number",
        default: 600,
        min: 0,
        max: 8000,
        unit: "px",
        hint: "0 = 自动按宽度等比缩放",
        visibleWhen: (v) => str(v, "maxWidth") === "custom",
      },
      {
        key: "fitMode",
        label: "缩放适配策略",
        type: "chips",
        default: "fit",
        options: [
          { label: "等比缩放 (适应框内)", value: "fit" },
          { label: "强制拉伸到指定宽高", value: "stretch" },
        ],
        visibleWhen: (v) => str(v, "maxWidth") === "custom",
      },
      {
        key: "rotate",
        label: "画面旋转与镜像",
        type: "chips",
        default: "none",
        options: [
          { label: "正常", value: "none" },
          { label: "顺时针 90°", value: "cw90" },
          { label: "逆时针 90°", value: "ccw90" },
          { label: "180°", value: "r180" },
          { label: "水平镜像", value: "hflip" },
          { label: "垂直镜像", value: "vflip" },
        ],
      },
      {
        key: "filter",
        label: "风格滤镜",
        type: "select",
        default: "none",
        options: [
          { label: "无滤镜 (原始色彩)", value: "none" },
          ...FILTER_STYLES.map((f) => ({ label: f.label, value: f.value })),
        ],
      },
      {
        key: "stripMeta",
        label: "清除 Exif 拍摄设备与 GPS 定位元数据（保护隐私）",
        type: "checkbox",
        default: true,
      },
    ],
    outputHint: (values) => {
      const maxW = str(values, "maxWidth");
      let maxWStr = "";
      if (maxW === "custom") {
        const cw = num(values, "customWidth");
        const ch = num(values, "customHeight");
        maxWStr = ` · 自定义尺寸 ${cw || "自适应"}×${ch || "自适应"}px`;
      } else {
        maxWStr = maxW !== "0" ? ` · 限制最长边 ${maxW}px` : " · 保持原图尺寸";
      }
      const fmt = str(values, "format").toUpperCase();
      const qStr = ["jpg", "webp"].includes(str(values, "format")) ? ` (质量 ${num(values, "quality")})` : "";
      const metaStr = values.stripMeta === true ? " · 剔除 Exif/GPS 隐私信息" : "";
      return `${fmt} 格式${qStr}${maxWStr}${metaStr}`;
    },
    build: ({ values, inputs }) => {
      const vf: string[] = [];

      // 1. 旋转 / 镜像
      const rot = str(values, "rotate");
      if (rot === "cw90") vf.push("transpose=1");
      else if (rot === "ccw90") vf.push("transpose=2");
      else if (rot === "r180") vf.push("transpose=1,transpose=1");
      else if (rot === "hflip") vf.push("hflip");
      else if (rot === "vflip") vf.push("vflip");

      // 2. 尺寸缩放
      const maxWVal = str(values, "maxWidth");
      if (maxWVal === "custom") {
        const cw = Math.round(num(values, "customWidth"));
        const ch = Math.round(num(values, "customHeight"));
        const fit = str(values, "fitMode");
        if (cw > 0 && ch > 0) {
          if (fit === "stretch") {
            vf.push(`scale=${cw}:${ch}`);
          } else {
            vf.push(`scale='if(gt(a,${cw}/${ch}),${cw},-2)':'if(gt(a,${cw}/${ch}),-2,${ch})'`);
          }
        } else if (cw > 0) {
          vf.push(`scale=${cw}:-2`);
        } else if (ch > 0) {
          vf.push(`scale=-2:${ch}`);
        }
      } else {
        const maxW = num(values, "maxWidth");
        if (maxW > 0) {
          vf.push(`scale='if(gt(max(iw,ih),${maxW}),if(gt(iw,ih),${maxW},-2),iw)':'if(gt(max(iw,ih),${maxW}),if(gt(iw,ih),-2,${maxW}),ih)'`);
        }
      }

      // 3. 滤镜风格
      const filterKey = str(values, "filter");
      const matchedFilter = FILTER_STYLES.find((f) => f.value === filterKey);
      if (matchedFilter) {
        vf.push(matchedFilter.vf);
      }

      const res = imageOutput(inputs[0], str(values, "format"), num(values, "quality"), vf);

      // 4. 清除元数据 (Exif / GPS)
      if (values.stripMeta === true) {
        res.args.push("-map_metadata", "-1", "-map_metadata:s:v:0", "-1");
      }

      return res;
    },
  },

  // ================= 9. 图片转 GIF =================
  {
    id: "image-gif",
    category: "image",
    name: "图片转 GIF 动图",
    icon: "🎞️",
    desc: "按顺序将多张 JPG、PNG 或 WebP 图片制作成可循环 GIF 动图，适合相册、表情和连环图。",
    accept: [IMAGE_ACCEPT],
    inputLabels: ["GIF 图片素材"],
    mergeList: true,
    fields: [
      { key: "duration", label: "单张停留时长", type: "number", default: 1.5, min: 0.1, max: 30, step: 0.1, unit: "秒" },
      { key: "fps", label: "帧率 (FPS)", type: "range", default: 12, min: 1, max: 30, hint: "GIF 帧率越高越流畅，文件也越大" },
      { key: "width", label: "输出宽度", type: "number", default: 720, min: 120, max: 1600, unit: "px", hint: "高度按图片比例自动计算" },
      {
        key: "loopMode",
        label: "循环模式",
        type: "chips",
        default: "infinite",
        options: [
          { label: "无限循环", value: "infinite" },
          { label: "单次播放", value: "once" },
        ],
      },
    ],
    outputHint: (values) =>
      `GIF · ${Math.round(num(values, "width"))}px 宽 · 每张 ${num(values, "duration")} 秒 · ${num(values, "fps")} FPS${str(values, "loopMode") === "once" ? " · 仅播一次" : " · 无限循环"}`,
    build: ({ values, inputs }) => {
      if (inputs.length < 1) throw new Error("图片转 GIF 至少需要 1 张图片");
      if (inputs.some((input) => !IMAGE_EXT.test(input))) throw new Error("图片转 GIF 只接受图片文件作为输入");
      const duration = Math.max(0.1, Math.min(30, num(values, "duration", 1.5)));
      const fps = Math.max(1, Math.min(30, Math.round(num(values, "fps", 12))));
      const width = Math.max(120, Math.min(1600, Math.round(num(values, "width", 720))));
      const segments = inputs.map(
        (_, i) => `[${i}:v]fps=${fps},scale=${width}:${width}:force_original_aspect_ratio=decrease,pad=${width}:${width}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,trim=duration=${duration},setpts=PTS-STARTPTS[v${i}]`,
      );
      const labels = inputs.map((_, i) => `[v${i}]`).join("");
      const filter = [
        ...segments,
        `${labels}concat=n=${inputs.length}:v=1:a=0[sequence]`,
        `[sequence]split=2[gifv][paletteSource]`,
        `[paletteSource]palettegen=max_colors=256:stats_mode=diff[palette]`,
        `[gifv][palette]paletteuse=dither=sierra2_4a[out]`,
      ].join(";");
      const args: string[] = [];
      for (const input of inputs) args.push("-loop", "1", "-i", input);
      args.push(
        "-filter_complex",
        filter,
        "-map",
        "[out]",
        "-t",
        (inputs.length * duration).toFixed(3),
        "-loop",
        str(values, "loopMode") === "once" ? "-1" : "0",
      );
      return { args, ext: "gif", mime: "image/gif" };
    },
  },

  // ================= 10. Meme 生成器 =================
  {
    id: "image-meme",
    category: "image",
    name: "Meme 生成器",
    icon: "😄",
    desc: "在画布上添加多张图片和多个文字图层，实时拖拽调整位置、大小、透明度、颜色与描边后导出 Meme。",
    accept: [IMAGE_ACCEPT],
    inputLabels: ["原始图片"],
    multiple: true,
    fields: [
      { key: "topText", label: "顶部文字", type: "text", default: "" },
      { key: "bottomText", label: "底部文字", type: "text", default: "" },
      { key: "fontSize", label: "文字大小", type: "range", default: 8, min: 2, max: 16, step: 0.5, unit: "%", hint: "相对于图片短边的比例" },
      { key: "textColor", label: "文字颜色", type: "color", default: "#ffffff" },
      { key: "strokeColor", label: "描边颜色", type: "color", default: "#000000" },
      { key: "strokeWidth", label: "描边强度", type: "range", default: 14, min: 0, max: 30, step: 1, unit: "%字体" },
      {
        key: "format",
        label: "输出格式",
        type: "select",
        default: "jpg",
        options: [
          { label: "JPG", value: "jpg" },
          { label: "PNG（保留透明区域）", value: "png" },
        ],
      },
      { ...QUALITY_FIELD, visibleWhen: IMG_QUALITY_VISIBLE },
    ],
    outputHint: (values) =>
      `${str(values, "format").toUpperCase()} Meme · ${str(values, "topText") || str(values, "bottomText") ? "已添加文字" : "无文字，仅导出图片"}`,
    preprocess: (file, values) =>
      renderMeme(file, {
        topText: str(values, "topText"),
        bottomText: str(values, "bottomText"),
        fontSize: num(values, "fontSize", 8),
        textColor: str(values, "textColor", "#ffffff"),
        strokeColor: str(values, "strokeColor", "#000000"),
        strokeWidth: num(values, "strokeWidth", 14),
        format: str(values, "format") === "png" ? "png" : "jpg",
        quality: num(values, "quality", 92),
      }),
    build: ({ values, inputs }) => {
      const format = str(values, "format") === "png" ? "png" : "jpg";
      return {
        args: ["-i", inputs[0], "-frames:v", "1", "-c:v", "copy"],
        ext: format,
        mime: format === "png" ? "image/png" : "image/jpeg",
      };
    },
  },

  // ================= 11. 智能证件照制作 =================
  {
    id: "id-photo",
    category: "image",
    name: "智能证件照制作",
    icon: "👔",
    desc: "启发式人像抠图换底，支持白/蓝/红/高级灰及自定义底色，按国家标准 300dpi 规格与多排版精确裁剪。支持批量。",
    accept: [PHOTO_ACCEPT],
    inputLabels: ["人像照片原图"],
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
        key: "customBg",
        label: "拾取自定义底色",
        type: "color",
        default: "#438EDB",
        hint: "支持点击色板挑选或输入 Hex",
        visibleWhen: (v) => str(v, "bg") === "custom",
      },
      {
        key: "layout",
        label: "排列排版",
        type: "chips",
        default: "single",
        options: [
          { label: "单张照（无排版）", value: "single" },
          { label: "4 张排版 (2×2)", value: "2x2" },
          { label: "8 张冲印 (2×4)", value: "2x4" },
          { label: "9 宫格 (3×3)", value: "3x3" },
          { label: "6寸相纸满铺 (冲印专用)", value: "print6" },
        ],
      },
      {
        key: "cutline",
        label: "添加裁切辅助虚线（方便手工剪裁）",
        type: "checkbox",
        default: true,
        visibleWhen: (v) => (str(v, "layout") || "single") !== "single",
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
        hint: "适当放大人像使头部比例更协调",
      },
      {
        key: "offsetY",
        label: "人物垂直位置微调",
        type: "range",
        default: 0,
        min: -30,
        max: 30,
        step: 1,
        unit: "%",
        hint: "正数人物偏下，负数人物偏上",
      },
      {
        key: "format",
        label: "输出格式",
        type: "select",
        default: "jpg",
        options: [
          { label: "JPG（通用图片）", value: "jpg" },
          { label: "PNG（无损透明通道）", value: "png" },
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
          { label: "200 KB (考试报名常用)", value: "200" },
          { label: "300 KB", value: "300" },
        ],
        visibleWhen: (v) => str(v, "format") === "jpg" && (str(v, "layout") || "single") === "single",
      },
    ],
    outputHint: (values) => {
      const spec = specOf(str(values, "spec"));
      const px = specPx(spec);
      const bg = str(values, "bg") === "custom"
        ? `自定义(${str(values, "customBg") || "#438EDB"})`
        : (ID_BG[str(values, "bg")]?.label ?? "白底");
      const layout = str(values, "layout") || "single";
      const layoutMap: Record<string, string> = {
        single: `单张 ${px.w}×${px.h}px`,
        "2x2": "4张排版 (2×2)",
        "2x4": "8张冲印排版 (2×4)",
        "3x3": "9张九宫格 (3×3)",
        print6: "6寸相纸标准冲印 (1800×1200px 满铺)",
      };
      const layoutDesc = layoutMap[layout] ?? "单张";
      return `规格：${spec.label} ${spec.wMm}×${spec.hMm}mm · 排列：${layoutDesc} · 底色：${bg}（300dpi 标准）`;
    },
    preprocess: (file, values) =>
      makeIdPhoto(file, {
        spec: str(values, "spec"),
        bg: str(values, "bg"),
        customBg: str(values, "customBg") || undefined,
        zoom: num(values, "zoom"),
        offsetY: num(values, "offsetY"),
        layout: (str(values, "layout") as any) || "single",
        cutline: values["cutline"] !== false,
        format: str(values, "format") === "png" ? "png" : "jpg",
        maxKB: Number(str(values, "maxKB")) || 0,
      }),
    build: ({ values, inputs }) => {
      const png = str(values, "format") === "png";
      return {
        args: ["-i", inputs[0], "-frames:v", "1", "-c:v", "copy"],
        ext: png ? "png" : "jpg",
        mime: png ? "image/png" : "image/jpeg",
      };
    },
  },

  // ================= 10. 图片自由 / 比例裁剪 =================
  {
    id: "image-crop",
    category: "image",
    name: "图片自由 / 比例裁剪",
    icon: "📐",
    desc: "按标准比例居中裁切（1:1/4:3/16:9）或精确自定义像素矩形区域。支持批量。",
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
          { label: "按比例（居中裁剪）", value: "ratio" },
          { label: "按像素（自定义坐标）", value: "pixel" },
        ],
      },
      {
        key: "ratio",
        label: "目标比例",
        type: "chips",
        default: "1:1",
        options: RATIO_OPTIONS.filter((o) => o.value !== "original"),
        visibleWhen: (v) => str(v, "mode") === "ratio",
      },
      { key: "x", label: "左边距 X", type: "number", default: 0, min: 0, max: 16000, unit: "px", visibleWhen: (v) => str(v, "mode") === "pixel" },
      { key: "y", label: "上边距 Y", type: "number", default: 0, min: 0, max: 16000, unit: "px", visibleWhen: (v) => str(v, "mode") === "pixel" },
      {
        key: "cw",
        label: "裁剪宽度",
        type: "number",
        default: 0,
        min: 0,
        max: 16000,
        unit: "px",
        hint: "0 = 自动延伸到右边界",
        visibleWhen: (v) => str(v, "mode") === "pixel",
      },
      {
        key: "ch",
        label: "裁剪高度",
        type: "number",
        default: 0,
        min: 0,
        max: 16000,
        unit: "px",
        hint: "0 = 自动延伸到下边界",
        visibleWhen: (v) => str(v, "mode") === "pixel",
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
      str(values, "mode") === "ratio"
        ? `按 ${str(values, "ratio")} 居中裁剪`
        : `裁剪区域：起点 (${num(values, "x")}, ${num(values, "y")})，宽 ${num(values, "cw") || "剩余"}、高 ${num(values, "ch") || "剩余"}（px）`,
    build: ({ values, inputs }) => {
      let vf: string[] = [];
      if (str(values, "mode") === "pixel") {
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

  // ================= 11. 批量图片水印 =================
  {
    id: "image-watermark",
    category: "image",
    name: "批量图片水印",
    icon: "💧",
    desc: "添加文字声明（版权、防盗图平铺）或图片 Logo 水印，支持九宫格定位与全屏斜纹。支持批量。",
    accept: [IMAGE_ACCEPT, IMAGE_ACCEPT],
    inputLabels: ["主图片", "水印图片（建议 PNG 透明背景）"],
    multiple: true,
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
        max: 15,
        step: 0.5,
        unit: "%",
        hint: "相对于图片短边的百分比",
        visibleWhen: textMode,
      },
      {
        key: "color",
        label: "文字颜色",
        type: "color",
        default: "#ffffff",
        visibleWhen: textMode,
      },
      {
        key: "opacity",
        label: "不透明度",
        type: "range",
        default: 40,
        min: 5,
        max: 100,
        unit: "%",
      },
      {
        key: "position",
        label: "水印位置",
        type: "chips",
        default: "tile",
        optionsFor: (v) => (imageMode(v) ? IMG_WM_POSITIONS : TEXT_WM_POSITIONS),
      },
      {
        key: "rotate",
        label: "文字倾斜角度",
        type: "range",
        default: -30,
        min: -90,
        max: 90,
        unit: "°",
        visibleWhen: textMode,
      },
      {
        key: "bold",
        label: "加粗文字",
        type: "checkbox",
        default: false,
        visibleWhen: textMode,
      },
      {
        key: "shadow",
        label: "文字阴影",
        type: "checkbox",
        default: true,
        visibleWhen: textMode,
      },
      {
        key: "scale",
        label: "Logo 大小",
        type: "range",
        default: 20,
        min: 5,
        max: 80,
        unit: "%",
        hint: "Logo 相对于主图宽度的比例",
        visibleWhen: imageMode,
      },
      {
        key: "margin",
        label: "边距",
        type: "range",
        default: 3,
        min: 0,
        max: 15,
        unit: "%",
        visibleWhen: (v) => str(v, "position") !== "tile" && str(v, "position") !== "center",
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
    outputHint: (values) =>
      imageMode(values)
        ? `图片水印：Logo 占宽 ${num(values, "scale")}% · 不透明度 ${num(values, "opacity")}%`
        : `文字水印：「${str(values, "text").slice(0, 10)}${str(values, "text").length > 10 ? "…" : ""}」· 不透明度 ${num(values, "opacity")}%`,
    overlay: (main, values) => {
      if (imageMode(values)) return Promise.resolve(null);
      return renderTextWatermark(main, {
        text: str(values, "text", "© 版权所有 请勿盗用"),
        position: str(values, "position", "tile"),
        size: num(values, "size", 4),
        sizePct: num(values, "size", 4),
        color: str(values, "color", "#ffffff"),
        opacity: num(values, "opacity", 40),
        opacityPct: num(values, "opacity", 40),
        rotate: num(values, "rotate", 0),
        rotateDeg: num(values, "rotate", 0),
        bold: values.bold === true,
        shadow: values.shadow !== false,
        margin: num(values, "margin", 3),
        marginPct: num(values, "margin", 3),
      });
    },
    build: ({ values, inputs }) => {
      const pos = str(values, "position");
      const margin = num(values, "margin") / 100;
      const op = num(values, "opacity") / 100;
      const enc = encodeArgs(str(values, "format"), num(values, "quality"));

      if (textMode(values)) {
        const fc = `[1:v]format=rgba[wm];[0:v][wm]overlay=0:0:format=auto[out]`;
        return {
          args: ["-i", inputs[0], "-i", inputs[1], "-filter_complex", fc, "-map", "[out]", ...enc.args],
          ext: enc.ext,
          mime: enc.mime,
        };
      }

      const scale = num(values, "scale") / 100;
      let posExpr = "x=(W-w)/2:y=(H-h)/2";
      if (pos === "lt") posExpr = `x=W*${margin}:y=H*${margin}`;
      else if (pos === "rt") posExpr = `x=W*(1-${margin})-w:y=H*${margin}`;
      else if (pos === "lb") posExpr = `x=W*${margin}:y=H*(1-${margin})-h`;
      else if (pos === "rb") posExpr = `x=W*(1-${margin})-w:y=H*(1-${margin})-h`;

      const fc = `[1:v]scale=iw*${scale}:-1,format=rgba,colorchannelmixer=aa=${op}[wm];[0:v][wm]overlay=${posExpr}[out]`;
      return {
        args: ["-i", inputs[0], "-i", inputs[1], "-filter_complex", fc, "-map", "[out]", ...enc.args],
        ext: enc.ext,
        mime: enc.mime,
      };
    },
  },

  // ================= 12. 多图横纵拼接 =================
  {
    id: "image-merge",
    category: "image",
    name: "多图横纵拼接",
    icon: "🧩",
    desc: "支持任意多张图片（2~30 张）上下纵向长图或左右横向拼接，可自定义拼接次序与对齐尺寸。",
    accept: [IMAGE_ACCEPT],
    inputLabels: ["拼接图片素材"],
    mergeList: true,
    fields: [
      {
        key: "direction",
        label: "拼接方向",
        type: "chips",
        default: "v",
        options: [
          { label: "上下纵向拼接（垂直长图）", value: "v" },
          { label: "左右横向拼接（横向卷轴）", value: "h" },
        ],
      },
      {
        key: "size",
        label: "基准对齐尺寸",
        type: "number",
        default: 1080,
        min: 64,
        max: 8000,
        unit: "px",
        hint: "纵向长图统一宽度，横向长图统一高度；其余维度保持原宽高比自动缩放",
      },
      {
        key: "gap",
        label: "拼接间距 (边距)",
        type: "range",
        default: 0,
        min: 0,
        max: 50,
        unit: "px",
        hint: "图片之间的留白间隔距离，0 为紧密无缝",
      },
      {
        key: "bgColor",
        label: "间距底色",
        type: "select",
        default: "white",
        options: [
          { label: "纯白底色 (白色留白)", value: "white" },
          { label: "纯黑底色 (暗黑对比)", value: "black" },
          { label: "浅灰底色", value: "#f1f5f9" },
          { label: "透明底色 (推荐 PNG/WebP)", value: "transparent" },
        ],
        visibleWhen: (v) => num(v, "gap") > 0,
      },
      {
        key: "format",
        label: "输出格式",
        type: "select",
        default: "jpg",
        options: [
          { label: "JPG（通用图片）", value: "jpg" },
          { label: "PNG（无损高清）", value: "png" },
          { label: "WebP（高压缩比）", value: "webp" },
        ],
      },
      { ...QUALITY_FIELD, default: 92, visibleWhen: IMG_QUALITY_VISIBLE },
    ],
    outputHint: (values) => {
      const isVertical = str(values, "direction") === "v";
      const dirText = isVertical ? "上下纵向长图" : "左右横向长图";
      const dimText = isVertical ? `统一宽度 ${num(values, "size")}px` : `统一高度 ${num(values, "size")}px`;
      const gap = num(values, "gap");
      const gapText = gap > 0 ? ` · 留白 ${gap}px` : "";
      const isJpgTrans = gap > 0 && str(values, "bgColor") === "transparent" && str(values, "format") === "jpg";
      const warnText = isJpgTrans ? "（⚠️ JPG不支持透明通道将呈黑底，建议选PNG/WebP）" : "";
      return `${dirText} · ${dimText}${gapText} · ${str(values, "format").toUpperCase()} 格式${warnText}`;
    },
    build: ({ values, inputs }) => {
      const s = Math.max(16, Math.round(num(values, "size")));
      const isVertical = str(values, "direction") === "v";
      const gap = Math.max(0, Math.round(num(values, "gap")));
      const bg = str(values, "bgColor");
      const padColor = bg === "transparent" ? "black@0.0" : bg === "white" ? "white" : bg === "black" ? "black" : "0xf1f5f9";
      const n = inputs.length;
      if (n < 2) throw new Error("多图拼接至少需要 2 张图片");

      const inputArgs: string[] = [];
      for (const inp of inputs) {
        inputArgs.push("-i", inp);
      }

      let fc = "";
      if (isVertical) {
        // 纵向长图：统一宽度为 s，高度缩放到偶数，若有间距在非末尾图底部补齐 gap
        const padSuffix = (i: number) => (gap > 0 && i < n - 1 ? `,pad=iw:ih+${gap}:0:0:color=${padColor}` : "");
        const scaleParts = inputs.map((_, i) => `[${i}:v]scale=${s}:-2,format=rgba${padSuffix(i)}[v${i}]`).join(";");
        const stackInputs = inputs.map((_, i) => `[v${i}]`).join("");
        fc = `${scaleParts};${stackInputs}vstack=inputs=${n}[out]`;
      } else {
        // 横向长图：统一高度为 s，宽度缩放到偶数，若有间距在非末尾图右侧补齐 gap
        const padSuffix = (i: number) => (gap > 0 && i < n - 1 ? `,pad=iw+${gap}:ih:0:0:color=${padColor}` : "");
        const scaleParts = inputs.map((_, i) => `[${i}:v]scale=-2:${s},format=rgba${padSuffix(i)}[v${i}]`).join(";");
        const stackInputs = inputs.map((_, i) => `[v${i}]`).join("");
        fc = `${scaleParts};${stackInputs}hstack=inputs=${n}[out]`;
      }

      const enc = encodeArgs(str(values, "format"), num(values, "quality"));
      return {
        args: [...inputArgs, "-filter_complex", fc, "-map", "[out]", ...enc.args],
        ext: enc.ext,
        mime: enc.mime,
      };
    },
  },
];

export function getTool(id: string): ToolDef {
  return TOOLS.find((t) => t.id === id) ?? TOOLS[0];
}

const presetMatches = (p: Preset, v: Values) => Object.entries(p.values).every(([k, val]) => v[k] === val);

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
  for (const f of tool.fields) {
    if (f.type !== "presets" || !f.presets?.length) continue;
    const p = f.presets.find((x) => x.value === f.default) ?? f.presets[0];
    Object.assign(out, p.values, { [f.key]: p.value });
  }
  return out;
}
