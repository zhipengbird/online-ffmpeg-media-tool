import { describe, it, expect } from "vitest";
import { formatBytes, formatTime, extOf, stem } from "./format";
import { matchesAccept } from "./accept";
import { TOOLS, getTool, getDefaults, changeValue } from "../lib/tools";

describe("Domain Algorithms - format utils", () => {
  it("formatBytes formats boundaries correctly", () => {
    expect(formatBytes(-1)).toBe("-");
    expect(formatBytes(NaN)).toBe("-");
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1048576)).toBe("1.0 MB");
    expect(formatBytes(1073741824)).toBe("1.0 GB");
  });

  it("formatTime formats seconds into mm:ss and hh:mm:ss", () => {
    expect(formatTime(0)).toBe("00:00");
    expect(formatTime(-10)).toBe("00:00");
    expect(formatTime(45)).toBe("00:45");
    expect(formatTime(65)).toBe("01:05");
    expect(formatTime(3600)).toBe("01:00:00");
    expect(formatTime(3665)).toBe("01:01:05");
  });

  it("extOf and stem parse file names accurately", () => {
    expect(extOf("video.MP4")).toBe("mp4");
    expect(extOf("archive.tar.gz")).toBe("gz");
    expect(extOf("noextension")).toBe("bin");

    expect(stem("video.mp4")).toBe("video");
    expect(stem("photo.high.quality.png")).toBe("photo.high.quality");
  });
});

describe("Domain Algorithms - accept matching", () => {
  it("matchesAccept handles extensions and MIME wildcards", () => {
    const mp4File = { name: "sample.mp4", type: "video/mp4" } as File;
    const pngFile = { name: "image.PNG", type: "image/png" } as File;

    expect(matchesAccept(".mp4,.mkv", mp4File)).toBe(true);
    expect(matchesAccept(".png", mp4File)).toBe(false);

    expect(matchesAccept("video/*", mp4File)).toBe(true);
    expect(matchesAccept("image/*", mp4File)).toBe(false);
    expect(matchesAccept("image/*", pngFile)).toBe(true);

    expect(matchesAccept(".png, image/jpeg", pngFile)).toBe(true);
  });
});

describe("Tool Registry & Schema", () => {
  it("all tools have valid ids, categories and build functions", () => {
    expect(TOOLS.length).toBe(12);
    for (const tool of TOOLS) {
      expect(tool.id).toBeTruthy();
      expect(tool.name).toBeTruthy();
      expect(tool.category).toBeTruthy();
      expect(typeof tool.build).toBe("function");

      const retrieved = getTool(tool.id);
      expect(retrieved.id).toBe(tool.id);

      const defaults = getDefaults(tool);
      expect(typeof defaults).toBe("object");
    }
  });

  it("consolidated video-transcode generates valid ffmpeg pipeline", () => {
    const tool = getTool("video-transcode");
    const defaults = getDefaults(tool);
    const result = tool.build({
      values: { ...defaults, format: "mp4", crf: 28, scale: "720", mute: true },
      inputs: ["input.mov"],
      infos: [],
    });
    expect(result.ext).toBe("mp4");
    expect(result.args).toContain("-crf");
    expect(result.args).toContain("28");
    expect(result.args).toContain("-an");
    expect(result.args.some((arg) => arg.includes("scale=-2:720"))).toBe(true);
  });

  it("consolidated video-edit combines trim, speed, and flip", () => {
    const tool = getTool("video-edit");
    const defaults = getDefaults(tool);
    const result = tool.build({
      values: { ...defaults, start: 2, end: 10, speed: "2", transform: "hflip" },
      inputs: ["sample.mp4"],
      infos: [{ duration: 20, hasAudio: true, width: 1920, height: 1080 } as any],
    });
    expect(result.ext).toBe("mp4");
    expect(result.args).toContain("-ss");
    expect(result.args).toContain("2");
    expect(result.args).toContain("-t");
    expect(result.args).toContain("8.000");
    const vfIndex = result.args.indexOf("-vf");
    expect(vfIndex).toBeGreaterThan(-1);
    expect(result.args[vfIndex + 1]).toContain("setpts=PTS/2");
    expect(result.args[vfIndex + 1]).toContain("hflip");
    const afIndex = result.args.indexOf("-af");
    expect(afIndex).toBeGreaterThan(-1);
    expect(result.args[afIndex + 1]).toContain("atempo=2");
  });

  it("consolidated audio-studio builds format, volume, and fade filters", () => {
    const tool = getTool("audio-studio");
    const defaults = getDefaults(tool);
    const result = tool.build({
      values: { ...defaults, format: "mp3", volume: 1.5, fadeIn: 2, fadeOut: 2, start: 0, end: 10 },
      inputs: ["track.wav"],
      infos: [{ duration: 10, hasAudio: true } as any],
    });
    expect(result.ext).toBe("mp3");
    const afIndex = result.args.indexOf("-af");
    expect(afIndex).toBeGreaterThan(-1);
    expect(result.args[afIndex + 1]).toContain("volume=1.5");
    expect(result.args[afIndex + 1]).toContain("afade=t=in:st=0:d=2");
    expect(result.args[afIndex + 1]).toContain("afade=t=out");
  });

  it("consolidated image-studio generates filters and quality", () => {
    const tool = getTool("image-studio");
    const defaults = getDefaults(tool);
    const result = tool.build({
      values: { ...defaults, format: "webp", quality: 80, filter: "bw", maxWidth: 1200, stripMeta: true },
      inputs: ["photo.png"],
      infos: [],
    });
    expect(result.ext).toBe("webp");
    expect(result.args).toContain("-map_metadata");
    expect(result.args).toContain("-1");
    const vfIndex = result.args.indexOf("-vf");
    expect(vfIndex).toBeGreaterThan(-1);
    expect(result.args[vfIndex + 1]).toContain("hue=s=0");
    expect(result.args[vfIndex + 1]).toContain("scale='if(gt(max(iw,ih),1200)");
  });

  it("video-transcode and audio-studio support batch processing", () => {
    const videoTool = getTool("video-transcode");
    expect(videoTool.multiple).toBe(true);

    const audioTool = getTool("audio-studio");
    expect(audioTool.multiple).toBe(true);
  });

  it("image-merge stitches arbitrary N images (3+) vertically and horizontally", () => {
    const tool = getTool("image-merge");
    expect(tool.mergeList).toBe(true);
    const defaults = getDefaults(tool);

    // 垂直拼接 3 张图
    const resV = tool.build({
      values: { ...defaults, direction: "v", size: 1080 },
      inputs: ["img1.png", "img2.jpg", "img3.webp"],
      infos: [],
    });
    const vfArgV = resV.args[resV.args.indexOf("-filter_complex") + 1];
    expect(vfArgV).toContain("vstack=inputs=3[out]");
    expect(vfArgV).toContain("[0:v]scale=1080:-2,format=rgba[v0]");
    expect(vfArgV).toContain("[2:v]scale=1080:-2,format=rgba[v2]");

    // 横向拼接 4 张图
    const resH = tool.build({
      values: { ...defaults, direction: "h", size: 720 },
      inputs: ["a.png", "b.png", "c.png", "d.png"],
      infos: [],
    });
    const vfArgH = resH.args[resH.args.indexOf("-filter_complex") + 1];
    expect(vfArgH).toContain("hstack=inputs=4[out]");
    expect(vfArgH).toContain("[0:v]scale=-2:720,format=rgba[v0]");
    expect(vfArgH).toContain("[3:v]scale=-2:720,format=rgba[v3]");
  });

  it("image-watermark generates valid overlay pipeline for text and image modes", async () => {
    const tool = getTool("image-watermark");
    const defaults = getDefaults(tool);

    // 文字水印模式
    const textRes = tool.build({
      values: { ...defaults, mode: "text", text: "测试水印", position: "tile" },
      inputs: ["photo.jpg", "watermark.png"],
      infos: [],
    });
    expect(textRes.args).toContain("-filter_complex");
    const textVf = textRes.args[textRes.args.indexOf("-filter_complex") + 1];
    expect(textVf).toContain("[1:v]format=rgba[wm]");
    expect(textVf).toContain("[0:v][wm]overlay=0:0:format=auto[out]");

    // 图片 Logo 模式
    const imgRes = tool.build({
      values: { ...defaults, mode: "image", position: "rb", scale: 25, margin: 5 },
      inputs: ["photo.jpg", "logo.png"],
      infos: [],
    });
    const imgVf = imgRes.args[imgRes.args.indexOf("-filter_complex") + 1];
    expect(imgVf).toContain("scale=iw*0.25:-1");
    expect(imgVf).toContain("overlay=x=W*(1-0.05)-w:y=H*(1-0.05)-h[out]");

    // overlay 钩子在图片模式下返回 null
    const dummyFile = new File(["dummy"], "test.png", { type: "image/png" });
    const nullOverlay = await tool.overlay!(dummyFile, { ...defaults, mode: "image" });
    expect(nullOverlay).toBeNull();
  });

  it("changeValue updates values map immutably", () => {
    const tool = TOOLS[0];
    const initial = getDefaults(tool);
    if (tool.fields.length > 0) {
      const field = tool.fields[0];
      const next = changeValue(tool, initial, field.key, "custom_val");
      expect(next[field.key]).toBe("custom_val");
    }
  });
});
