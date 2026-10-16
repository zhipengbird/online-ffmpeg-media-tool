import { describe, it, expect } from "vitest";
import { formatBytes, formatTime, extOf, stem } from "./format";
import { matchesAccept } from "./accept";
import { TOOLS, getTool, getDefaults, changeValue } from "../lib/tools";
import { hexToRgb } from "../lib/idphoto";

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
    expect(TOOLS.length).toBe(14);
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

  it("video-frame supports both single-frame capture and contact sheets", () => {
    const tool = getTool("video-frame");
    const defaults = getDefaults(tool);

    const single = tool.build({ values: defaults, inputs: ["clip.mp4"], infos: [] });
    expect(single.ext).toBe("png");
    expect(single.args).toContain("-frames:v");
    expect(single.args).not.toContain("-vf");

    const contact = tool.build({
      values: { ...defaults, mode: "contact", interval: 1.5, count: 6, thumbWidth: 320, format: "jpg" },
      inputs: ["clip.mp4"],
      infos: [],
    });
    const vf = contact.args[contact.args.indexOf("-vf") + 1];
    expect(contact.ext).toBe("jpg");
    expect(vf).toContain("fps=1/1.5");
    expect(vf).toContain("select='lte(n\\,5)'");
    expect(vf).toContain("tile=3x2");
  });

  it("video-img2vid builds canvas-fit and Ken Burns motion filters", () => {
    const tool = getTool("video-img2vid");
    const defaults = getDefaults(tool);
    const result = tool.build({
      values: { ...defaults, duration: 8, fps: 25, canvas: "portrait", fit: "contain", motion: "zoom-in" },
      inputs: ["cover.jpg", "cover-2.jpg"],
      infos: [{ duration: 0, hasVideo: true, hasAudio: false, width: 1920, height: 1080 }],
    });
    const filterGraph = result.args[result.args.indexOf("-filter_complex") + 1];
    expect(result.ext).toBe("mp4");
    expect(filterGraph).toContain("pad=720:1280");
    expect(filterGraph).toContain("zoompan=");
    expect(filterGraph).toContain("d=200");
    expect(filterGraph).toContain("s=720x1280");
    expect(filterGraph).toContain("concat=n=2");

    const fade = tool.build({
      values: { ...defaults, duration: 2, transition: "fade" },
      inputs: ["one.jpg", "two.jpg", "three.jpg"],
      infos: [],
    });
    const fadeGraph = fade.args[fade.args.indexOf("-filter_complex") + 1];
    expect(fadeGraph).toContain("xfade=transition=fade");
    expect(fadeGraph).toContain("offset=1.500");

    const withAudio = tool.build({
      values: { ...defaults, soundtrack: "audio", audioBitrate: "192k" },
      inputs: ["cover.jpg", "music.mp3"],
      infos: [{ duration: 0, hasVideo: true, hasAudio: false, width: 1280, height: 720 }],
    });
    expect(withAudio.args).toContain("-map");
    expect(withAudio.args).toContain("1:a:0");
    expect(withAudio.args).toContain("192k");
  });

  it("video-img2vid supports pan motion, visual styles, and wipe transitions", () => {
    const tool = getTool("video-img2vid");
    const defaults = getDefaults(tool);
    const result = tool.build({
      values: {
        ...defaults,
        duration: 3,
        fps: 20,
        motion: "pan-left",
        style: "sepia",
        transition: "wipeleft",
      },
      inputs: ["one.jpg", "two.jpg"],
      infos: [],
    });
    const filterGraph = result.args[result.args.indexOf("-filter_complex") + 1];
    expect(filterGraph).toContain("crop=w='iw*0.88':h='ih*0.88'");
    expect(filterGraph).toContain("colorchannelmixer=.393:.769:.189");
    expect(filterGraph).toContain("xfade=transition=wipeleft");
    expect(tool.outputHint?.({ ...defaults, motion: "pan-left", style: "sepia", transition: "wipeleft" })).toContain("向左平移");
    expect(tool.outputHint?.({ ...defaults, motion: "pan-left", style: "sepia", transition: "wipeleft" })).toContain("复古棕褐");
    expect(tool.outputHint?.({ ...defaults, motion: "pan-left", style: "sepia", transition: "wipeleft" })).toContain("向左擦除");
  });

  it("image-gif builds a multi-image palette pipeline", () => {
    const tool = getTool("image-gif");
    const defaults = getDefaults(tool);
    const result = tool.build({
      values: { ...defaults, duration: 0.8, fps: 10, width: 480, loopMode: "once" },
      inputs: ["one.jpg", "two.png", "three.webp"],
      infos: [],
    });
    const filterGraph = result.args[result.args.indexOf("-filter_complex") + 1];
    expect(result.ext).toBe("gif");
    expect(result.args.filter((arg) => arg === "-loop")).toHaveLength(4);
    expect(filterGraph).toContain("concat=n=3:v=1:a=0");
    expect(filterGraph).toContain("pad=480:480");
    expect(filterGraph).toContain("palettegen=max_colors=256");
    expect(filterGraph).toContain("paletteuse=dither=sierra2_4a");
    expect(result.args).toContain("-1");
  });

  it("image-meme exposes Canvas caption settings and image output", () => {
    const tool = getTool("image-meme");
    const defaults = getDefaults(tool);
    const result = tool.build({ values: { ...defaults, format: "png" }, inputs: ["input.png"], infos: [] });
    expect(tool.multiple).toBe(true);
    expect(tool.preprocess).toBeTypeOf("function");
    expect(result.ext).toBe("png");
    expect(result.args).toEqual(["-i", "input.png", "-frames:v", "1", "-c:v", "copy"]);
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

  it("id-photo tool provides layout configuration and formats outputHint accurately", () => {
    const tool = getTool("id-photo");
    const defaults = getDefaults(tool);
    expect(defaults["layout"]).toBe("single");
    expect(defaults["cutline"]).toBe(true);

    const layoutField = tool.fields.find((f) => f.key === "layout");
    expect(layoutField).toBeDefined();
    expect(layoutField?.options?.some((o) => o.value === "2x4")).toBe(true);
    expect(layoutField?.options?.some((o) => o.value === "print6")).toBe(true);

    const hintSingle = tool.outputHint?.(defaults, []);
    expect(hintSingle).toContain("单张");

    const hintPrint = tool.outputHint?.({ ...defaults, layout: "print6" }, []);
    expect(hintPrint).toContain("6寸相纸标准冲印");
  });

  it("video-gif supports infinite, once, and boomerang loop modes", () => {
    const tool = getTool("video-gif");
    const defaults = getDefaults(tool);

    // 标准循环
    const resInf = tool.build({
      values: { ...defaults, loopMode: "infinite", width: 480, fps: 10 },
      inputs: ["clip.mp4"],
      infos: [],
    });
    expect(resInf.ext).toBe("gif");
    expect(resInf.args).toContain("-loop");
    expect(resInf.args[resInf.args.indexOf("-loop") + 1]).toBe("0");

    // 乒乓反弹模式
    const resBoom = tool.build({
      values: { ...defaults, loopMode: "boomerang", width: 360, fps: 12 },
      inputs: ["clip.mp4"],
      infos: [],
    });
    const vfBoom = resBoom.args[resBoom.args.indexOf("-vf") + 1];
    expect(vfBoom).toContain("reverse");
    expect(vfBoom).toContain("concat=n=2:v=1");
  });

  it("audio-studio supports playback speed control via atempoChain", () => {
    const tool = getTool("audio-studio");
    const defaults = getDefaults(tool);

    const resFast = tool.build({
      values: { ...defaults, speed: "1.5" },
      inputs: ["speech.mp3"],
      infos: [{ duration: 60 } as any],
    });
    const af = resFast.args[resFast.args.indexOf("-af") + 1];
    expect(af).toContain("atempo=1.5");
  });

  it("image-merge supports gap and background color padding", () => {
    const tool = getTool("image-merge");
    const defaults = getDefaults(tool);

    const resWithGap = tool.build({
      values: { ...defaults, direction: "v", gap: 20, bgColor: "white" },
      inputs: ["img1.png", "img2.png"],
      infos: [],
    });
    const fc = resWithGap.args[resWithGap.args.indexOf("-filter_complex") + 1];
    expect(fc).toContain("pad=iw:ih+20:0:0:color=white");
  });

  it("image-studio supports exact custom width/height and stretch/fit mode", () => {
    const tool = getTool("image-studio");
    const defaults = getDefaults(tool);

    // 等比适应
    const resFit = tool.build({
      values: { ...defaults, maxWidth: "custom", customWidth: 1000, customHeight: 800, fitMode: "fit" },
      inputs: ["sample.jpg"],
      infos: [],
    });
    const vfFit = resFit.args[resFit.args.indexOf("-vf") + 1];
    expect(vfFit).toContain("scale=");
    expect(vfFit).toContain("1000/800");

    // 强制拉伸
    const resStretch = tool.build({
      values: { ...defaults, maxWidth: "custom", customWidth: 600, customHeight: 400, fitMode: "stretch" },
      inputs: ["sample.jpg"],
      infos: [],
    });
    const vfStretch = resStretch.args[resStretch.args.indexOf("-vf") + 1];
    expect(vfStretch).toContain("scale=600:400");
  });

  it("id-photo supports custom background colors and hexToRgb parsing", () => {
    // hexToRgb 边界测试
    expect(hexToRgb("#fff")).toEqual([255, 255, 255]);
    expect(hexToRgb("#000000")).toEqual([0, 0, 0]);
    expect(hexToRgb("438EDB")).toEqual([67, 142, 219]);
    expect(hexToRgb("#invalid")).toBeNull();

    const tool = getTool("id-photo");
    const defaults = getDefaults(tool);

    // 测试输出提示文案在自定义颜色时的反映
    const hintCustom = tool.outputHint?.({
      ...defaults,
      spec: "1inch",
      bg: "custom",
      customBg: "#10b981",
    });
    expect(hintCustom).toContain("自定义(#10b981)");

    const hintGray = tool.outputHint?.({
      ...defaults,
      spec: "2inch",
      bg: "gray",
    });
    expect(hintGray).toContain("高级灰底");
  });
});
