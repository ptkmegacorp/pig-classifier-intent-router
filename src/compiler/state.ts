import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

export interface PigCommandState {
  activeDisplay: boolean;
  recentScreenshotPath: string | null;
  lastImagePath: string | null;
  latestPhotoPath: string | null;
  defaultLocation: string | null;
  focusedWindowName: string | null;
  focusedWorkspace: string | null;
  selectedText: string | null;
}

function screenshotDir(): string { return process.env.SCREENSHOT_DIR ?? "/home/bot/screenshots"; }
function photoDir(): string { return process.env.PIG_PHOTO_DIR ?? "/home/bot/.pig/agent/skills/take-photo/assets/photos"; }

function readPointer(path: string): string | null {
  if (!existsSync(path)) return null;
  try { const value = readFileSync(path, "utf-8").trim(); return value || null; } catch { return null; }
}

function newestFile(dir: string, extensions: string[]): string | null {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && extensions.some((ext) => entry.name.toLowerCase().endsWith(ext)))
      .map((entry) => join(dir, entry.name))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] ?? null;
  } catch { return null; }
}

function command(command: string, args: string[], timeout = 750): string | null {
  try { return execFileSync(command, args, { encoding: "utf-8", timeout, stdio: ["ignore", "pipe", "ignore"] }).trim() || null; } catch { return null; }
}

function focusedWorkspace(): string | null {
  const raw = command("i3-msg", ["-t", "get_workspaces"]);
  if (!raw) return null;
  try { return JSON.parse(raw).find((w: any) => w.focused)?.name ?? null; } catch { return null; }
}

function focusedWindowName(): string | null {
  const raw = command("xdotool", ["getactivewindow", "getwindowname"]);
  return raw;
}

function selectedText(): string | null {
  return command("xclip", ["-selection", "primary", "-o"], 300) ?? command("xclip", ["-selection", "clipboard", "-o"], 300);
}

export function getPigCommandState(): PigCommandState {
  const recentScreenshotPath = readPointer(join(screenshotDir(), "latest-screenshot"));
  const latestPhotoPath = newestFile(photoDir(), [".png", ".jpg", ".jpeg", ".webp", ".heic"]);
  return {
    activeDisplay: Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY || existsSync("/tmp/.X11-unix/X0")),
    recentScreenshotPath,
    lastImagePath: latestPhotoPath ?? recentScreenshotPath,
    latestPhotoPath,
    defaultLocation: process.env.PIG_DEFAULT_LOCATION ?? "Jim Falls, WI",
    focusedWindowName: focusedWindowName(),
    focusedWorkspace: focusedWorkspace(),
    selectedText: selectedText(),
  };
}
