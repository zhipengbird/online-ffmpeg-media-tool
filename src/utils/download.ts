/** 通过临时 <a> 标签触发浏览器下载 */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 延迟 10 秒释放，确保移动端弹窗确认或大文件开始缓冲时不被过早注销
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * 将多个文件打包为 ZIP。
 * 若存在同名文件，自动追加序号（如 a.jpg、a-1.jpg），避免覆盖。
 */
export async function zipFiles(entries: { name: string; blob: Blob }[]): Promise<Blob> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const used = new Set<string>();
  for (const { name, blob } of entries) {
    let final = name;
    let n = 1;
    while (used.has(final)) {
      final = name.replace(/(\.[^.]+)?$/, (ext) => `-${n}${ext}`);
      n += 1;
    }
    used.add(final);
    zip.file(final, blob);
  }
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}
