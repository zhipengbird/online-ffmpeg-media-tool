import type { MediaInfo } from "./ffmpeg";

/**
 * 批量任务的数据模型
 * - idle：等待处理 / 尚未处理
 * - running：正在处理
 * - done：处理成功，result 中包含输出文件
 * - error：处理失败，error 中包含原因
 * - cancelled：用户取消时正在处理的那一项
 */
export type BatchStatus = "idle" | "running" | "done" | "error" | "cancelled";

export interface BatchResult {
  url: string;
  name: string;
  mime: string;
  size: number;
}

export interface BatchItem {
  id: string;
  file: File;
  info: MediaInfo | null;
  probing: boolean;
  status: BatchStatus;
  /** 当前项的 FFmpeg 进度 0~1 */
  progress: number;
  error?: string;
  result?: BatchResult;
}

let seq = 0;

export function createBatchItem(file: File): BatchItem {
  seq += 1;
  return {
    id: `${Date.now().toString(36)}-${seq}`,
    file,
    info: null,
    probing: true,
    status: "idle",
    progress: 0,
  };
}

/** 释放一组任务中所有输出的 Blob URL */
export function revokeBatchResults(items: BatchItem[]): void {
  for (const item of items) {
    if (item.result) URL.revokeObjectURL(item.result.url);
  }
}

/** 清除所有任务的处理结果（保留文件与媒体信息），用于重新执行 */
export function resetBatchItems(items: BatchItem[]): BatchItem[] {
  revokeBatchResults(items);
  return items.map((item) => ({
    ...item,
    status: "idle",
    progress: 0,
    error: undefined,
    result: undefined,
  }));
}
