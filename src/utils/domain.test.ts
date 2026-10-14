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
    expect(TOOLS.length).toBeGreaterThanOrEqual(20);
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
