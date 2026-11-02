import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer, { type Browser, type CDPSession, type Page } from 'puppeteer-core';

export const VIEW_WIDTH = 1920;
export const VIEW_HEIGHT = 1080;

const CHROME = '/usr/local/bin/google-chrome';

export class CheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CheckError';
  }
}

export interface FrameDiff {
  changedPixels: number;
  totalPixels: number;
  maxChannelDelta: number;
  meanAbsDelta: number;
}

export interface DioramaInfo {
  width: number;
  height: number;
  loopSeconds: number;
}

interface PageDiorama {
  readonly width: number;
  readonly height: number;
  readonly loopSeconds: number;
  renderAt(t: number): { particles: number };
  hash(t: number): string;
  diff(tA: number, tB: number): FrameDiff;
  stats(): { frames: number };
}

declare global {
  interface Window {
    __diorama?: PageDiorama;
  }
}

export function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

export function repoPath(rel: string): string {
  return path.resolve(repoRoot(), rel);
}

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

export function parseFlags(argv: string[], allowed: readonly string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] ?? '';
    if (!token.startsWith('--') || token.length < 3) {
      throw new CheckError(`unexpected argument ${token}`);
    }
    const key = token.slice(2);
    if (!allowed.includes(key)) throw new CheckError(`unknown flag --${key}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new CheckError(`missing value for --${key}`);
    }
    if (flags.has(key)) throw new CheckError(`duplicate flag --${key}`);
    flags.set(key, value);
    i++;
  }
  return flags;
}

export function numberFlag(flags: Map<string, string>, key: string, fallback: number): number {
  const raw = flags.get(key);
  if (raw === undefined) return fallback;
  if (raw.trim() === '' || !Number.isFinite(Number(raw))) {
    throw new CheckError(`--${key} must be a finite number, got ${raw}`);
  }
  return Number(raw);
}

export function positiveFlag(flags: Map<string, string>, key: string, fallback: number): number {
  const value = numberFlag(flags, key, fallback);
  if (!(value > 0)) throw new CheckError(`--${key} must be positive, got ${value}`);
  return value;
}

export function defaultPageUrl(): string {
  const html = path.join(repoRoot(), 'dist', 'index.html');
  if (!existsSync(html)) {
    throw new CheckError(`missing ${html}. run npm run build first`);
  }
  const url = pathToFileURL(html);
  url.searchParams.set('paused', '1');
  return url.href;
}

export async function withDiorama(
  url: string | undefined,
  run: (page: Page, cdp: CDPSession) => Promise<void>,
): Promise<void> {
  const target = url ?? defaultPageUrl();
  const browser = await launch(target);
  try {
    const page = await browser.newPage();
    await page.setViewport({
      width: VIEW_WIDTH,
      height: VIEW_HEIGHT,
      deviceScaleFactor: 1,
    });
    await page.goto(target, { waitUntil: 'load', timeout: 60_000 });
    try {
      await page.waitForFunction('window.__diorama != null', { timeout: 30_000 });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new CheckError(`window.__diorama did not appear at ${target} (${reason})`);
    }
    const cdp = await page.createCDPSession();
    await cdp.send('Performance.enable');
    await cdp.send('HeapProfiler.enable');
    await run(page, cdp);
  } finally {
    await browser.close();
  }
}

async function launch(target: string): Promise<Browser> {
  try {
    return await puppeteer.launch({
      executablePath: CHROME,
      headless: true,
      protocolTimeout: 300_000,
      defaultViewport: {
        width: VIEW_WIDTH,
        height: VIEW_HEIGHT,
        deviceScaleFactor: 1,
      },
      args: [
        '--no-sandbox',
        '--hide-scrollbars',
        '--enable-precise-memory-info',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
      ],
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new CheckError(`failed to launch Chrome for ${target} (${reason})`);
  }
}

export async function readInfo(page: Page): Promise<DioramaInfo> {
  const info = await page.evaluate(() => {
    const api = window.__diorama;
    if (!api) throw new Error('window.__diorama is missing');
    return { width: api.width, height: api.height, loopSeconds: api.loopSeconds };
  });
  if (
    !Number.isFinite(info.width) ||
    !Number.isFinite(info.height) ||
    !Number.isFinite(info.loopSeconds) ||
    info.width <= 0 ||
    info.height <= 0 ||
    info.loopSeconds <= 0
  ) {
    throw new CheckError(`window.__diorama returned an unusable size or loop (${JSON.stringify(info)})`);
  }
  return info;
}

export async function present(page: Page, t: number): Promise<void> {
  await page.evaluate(async (time) => {
    const api = window.__diorama;
    if (!api) throw new Error('window.__diorama is missing');
    api.renderAt(time);
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  }, t);
}

export async function canvasSize(page: Page): Promise<{ width: number; height: number }> {
  return page.evaluate(() => {
    const canvas = document.querySelector('#screen');
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('missing #screen canvas');
    return { width: canvas.width, height: canvas.height };
  });
}

export async function canvasPixel(
  page: Page,
  x: number,
  y: number,
): Promise<[number, number, number]> {
  const pixel = await page.evaluate((px, py) => {
    const canvas = document.querySelector('#screen');
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('missing #screen canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('#screen has no 2d context');
    const data = ctx.getImageData(px, py, 1, 1).data;
    return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0];
  }, x, y);
  return [pixel[0] ?? 0, pixel[1] ?? 0, pixel[2] ?? 0];
}

export async function diffAt(page: Page, tA: number, tB: number): Promise<FrameDiff> {
  const raw = await page.evaluate((a, b) => {
    const api = window.__diorama;
    if (!api) throw new Error('window.__diorama is missing');
    return api.diff(a, b);
  }, tA, tB);
  if (!isFrameDiff(raw)) throw new CheckError(`diff(${tA}, ${tB}) returned an unexpected shape`);
  return raw;
}

export async function hashAt(page: Page, t: number): Promise<string> {
  const value = await page.evaluate((time) => {
    const api = window.__diorama;
    if (!api) throw new Error('window.__diorama is missing');
    return api.hash(time);
  }, t);
  if (typeof value !== 'string' || value.length === 0) {
    throw new CheckError(`hash(${t}) did not return a string`);
  }
  return value;
}

export async function statsFrames(page: Page): Promise<number> {
  const value = await page.evaluate(() => {
    const api = window.__diorama;
    if (!api) throw new Error('window.__diorama is missing');
    return api.stats().frames;
  });
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new CheckError('stats().frames is not a finite number');
  }
  return value;
}

function isFrameDiff(value: unknown): value is FrameDiff {
  if (typeof value !== 'object' || value === null) return false;
  if (
    !('changedPixels' in value) ||
    !('totalPixels' in value) ||
    !('maxChannelDelta' in value) ||
    !('meanAbsDelta' in value)
  ) {
    return false;
  }
  return (
    typeof value.changedPixels === 'number' &&
    typeof value.totalPixels === 'number' &&
    typeof value.maxChannelDelta === 'number' &&
    typeof value.meanAbsDelta === 'number' &&
    Number.isFinite(value.changedPixels) &&
    Number.isFinite(value.totalPixels) &&
    Number.isFinite(value.maxChannelDelta) &&
    Number.isFinite(value.meanAbsDelta)
  );
}

export interface RgbImage {
  width: number;
  height: number;
  rgb: Buffer;
}

export function decodePng(file: string): RgbImage {
  const stream = readProbe(file, false);
  const rgb = execFile(
    'ffmpeg',
    ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'],
    32 * 1024 * 1024,
  );
  const expected = stream.width * stream.height * 3;
  if (rgb.length !== expected) {
    throw new CheckError(`${file} decoded to ${rgb.length} bytes, expected ${expected}`);
  }
  return { width: stream.width, height: stream.height, rgb };
}

export function countDistinctColors(rgb: Buffer): number {
  const colors = new Set<number>();
  for (let i = 0; i < rgb.length; i += 3) {
    colors.add(((rgb[i] ?? 0) << 16) | ((rgb[i + 1] ?? 0) << 8) | (rgb[i + 2] ?? 0));
  }
  return colors.size;
}

export function countDifferingPixels(a: Buffer, b: Buffer): number {
  if (a.length !== b.length) {
    throw new CheckError(`rgb length mismatch ${a.length} vs ${b.length}`);
  }
  let differ = 0;
  for (let i = 0; i < a.length; i += 3) {
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) differ++;
  }
  return differ;
}

export function pngPixel(rgb: Buffer, width: number, x: number, y: number): [number, number, number] {
  const index = (y * width + x) * 3;
  return [rgb[index] ?? 0, rgb[index + 1] ?? 0, rgb[index + 2] ?? 0];
}

export interface VideoProbe {
  width: number;
  height: number;
  frames: number;
  duration: number;
  codec: string;
  pixFmt: string;
}

export function probeVideo(file: string): VideoProbe {
  const stream = readProbe(file, false);
  const frames = stream.frames ?? readProbe(file, true).frames;
  if (frames === undefined) throw new CheckError(`${file} has no frame count`);
  if (stream.duration === undefined) throw new CheckError(`${file} has no duration`);
  if (stream.codec === undefined) throw new CheckError(`${file} has no codec`);
  if (stream.pixFmt === undefined) throw new CheckError(`${file} has no pix_fmt`);
  return {
    width: stream.width,
    height: stream.height,
    frames,
    duration: stream.duration,
    codec: stream.codec,
    pixFmt: stream.pixFmt,
  };
}

interface ProbeStream {
  width: number;
  height: number;
  frames?: number;
  duration?: number;
  codec?: string;
  pixFmt?: string;
}

function readProbe(file: string, countFrames: boolean): ProbeStream {
  const entries = countFrames
    ? 'stream=width,height,nb_read_frames,nb_frames,duration,codec_name,pix_fmt'
    : 'stream=width,height,nb_frames,duration,codec_name,pix_fmt';
  const args = ['-v', 'error', '-select_streams', 'v:0'];
  if (countFrames) args.push('-count_frames');
  args.push('-show_entries', entries, '-of', 'json', file);
  const text = execText('ffprobe', args);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CheckError(`ffprobe returned invalid JSON for ${file}`);
  }
  const stream = firstStream(parsed, file);
  const width = requireNumber(stream, 'width', file);
  const height = requireNumber(stream, 'height', file);
  return {
    width,
    height,
    frames: optionalNumber(stream.get('nb_read_frames') ?? stream.get('nb_frames')),
    duration: optionalNumber(stream.get('duration')),
    codec: optionalString(stream.get('codec_name')),
    pixFmt: optionalString(stream.get('pix_fmt')),
  };
}

function firstStream(json: unknown, file: string): Map<string, unknown> {
  const root = asRecord(json);
  const streams = root?.get('streams');
  if (!Array.isArray(streams) || streams.length === 0) {
    throw new CheckError(`ffprobe returned no video stream for ${file}`);
  }
  const stream = asRecord(streams[0]);
  if (!stream) throw new CheckError(`ffprobe stream is not an object for ${file}`);
  return stream;
}

function asRecord(value: unknown): Map<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return new Map(Object.entries(value));
}

function optionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value !== 'N/A' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string' || value === '' || value === 'N/A') return undefined;
  return value;
}

function requireNumber(stream: Map<string, unknown>, key: string, file: string): number {
  const value = optionalNumber(stream.get(key));
  if (value === undefined) throw new CheckError(`${file} is missing ${key}`);
  return value;
}

function execText(cmd: string, args: string[]): string {
  const out = execFile(cmd, args, 16 * 1024 * 1024, 'utf8');
  return out;
}

function execFile(cmd: string, args: string[], maxBuffer: number): Buffer;
function execFile(cmd: string, args: string[], maxBuffer: number, encoding: 'utf8'): string;
function execFile(cmd: string, args: string[], maxBuffer: number, encoding?: 'utf8'): Buffer | string {
  try {
    if (encoding) return execFileSync(cmd, args, { encoding, maxBuffer });
    return execFileSync(cmd, args, { maxBuffer });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new CheckError(`${cmd} failed: ${reason}`);
  }
}

export function reportFailure(error: unknown): never {
  if (error instanceof CheckError) console.error(error.message);
  else if (error instanceof Error) console.error(error.stack ?? error.message);
  else console.error(String(error));
  process.exit(1);
}
