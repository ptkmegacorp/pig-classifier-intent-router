import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface PigCommandState {
  activeDisplay: boolean;
  recentScreenshotPath: string | null;
  lastImagePath: string | null;
  latestPhotoPath: string | null;
  defaultLocation: string | null;
}

function screenshotDir(): string {
  return process.env.SCREENSHOT_DIR ?? "/home/bot/screenshots";
}

function readPointer(path: string): string | null {
  if (!existsSync(path)) return null;
  try {
    const value = readFileSync(path, "utf-8").trim();
    return value || null;
  } catch {
    return null;
  }
}

export function getPigCommandState(): PigCommandState {
  const recentScreenshotPath = readPointer(join(screenshotDir(), "latest-screenshot"));
  return {
    activeDisplay: Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY || existsSync("/tmp/.X11-unix/X0")),
    recentScreenshotPath,
    lastImagePath: recentScreenshotPath,
    latestPhotoPath: null,
    defaultLocation: process.env.PIG_DEFAULT_LOCATION ?? "Jim Falls, WI",
  };
}
