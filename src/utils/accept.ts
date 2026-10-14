/**
 * 判断文件是否符合 <input accept> 形式的过滤器字符串。
 * 支持三种写法（逗号分隔，可混用）：
 *   - ".mp4"           扩展名匹配（不区分大小写）
 *   - "video/*"        MIME 前缀匹配
 *   - "image/png"      完整 MIME 匹配
 */
export function matchesAccept(accept: string, file: File): boolean {
  const name = file.name.toLowerCase();
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot) : "";
  const mime = (file.type || "").toLowerCase();

  return accept
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .some((token) => {
      if (token.startsWith(".")) return token === ext;
      if (token.endsWith("/*")) return mime.startsWith(token.slice(0, -1));
      return mime === token;
    });
}
