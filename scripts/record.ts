import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { once } from 'node:events';
import type { CDPSession } from 'puppeteer-core';
import {
  VIEW_HEIGHT,
  VIEW_WIDTH,
  CheckError,
  canvasSize,
  ensureDir,
  numberFlag,
  parseFlags,
  positiveFlag,
  present,
  probeVideo,
  reportFailure,
  repoPath,
  withDiorama,
} from './browser.ts';

async function main(): Promise<void> {
  const started = performance.now();
  const flags = parseFlags(process.argv.slice(2), ['url', 'start', 'duration', 'fps', 'out']);
  const start = numberFlag(flags, 'start', 35);
  const duration = positiveFlag(flags, 'duration', 10);
  const fps = positiveFlag(flags, 'fps', 30);
  const frameCount = Math.round(fps * duration);
  if (Math.abs(fps * duration - frameCount) > 1e-6) {
    throw new CheckError(`--fps ${fps} times --duration ${duration} is not an integer frame count`);
  }
  const out = repoPath(flags.get('out') ?? 'artifacts/recording-10s.mp4');
  ensureDir(path.dirname(out));

  let renderMs = 0;
  let captureMs = 0;
  await withDiorama(flags.get('url'), async (page, cdp) => {
    const size = await canvasSize(page);
    if (size.width !== VIEW_WIDTH || size.height !== VIEW_HEIGHT) {
      throw new CheckError(`#screen is ${size.width}x${size.height}, expected ${VIEW_WIDTH}x${VIEW_HEIGHT}`);
    }
    const ffmpeg = startFfmpeg(out, fps);
    try {
      for (let i = 0; i < frameCount; i++) {
        const t = (start * fps + i) / fps;
        const renderAt = performance.now();
        await present(page, t);
        renderMs += performance.now() - renderAt;
        const captureAt = performance.now();
        const png = await capturePng(cdp);
        captureMs += performance.now() - captureAt;
        await writeFrame(ffmpeg, png);
        if (i % fps === 0) console.log(`frame ${i}/${frameCount} t=${t.toFixed(3)}`);
      }
      await finishFfmpeg(ffmpeg);
    } catch (error) {
      ffmpeg.child.stdin?.destroy();
      ffmpeg.child.kill('SIGKILL');
      throw error;
    }
  });

  const probe = probeVideo(out);
  const expectedDuration = frameCount / fps;
  const wall = (performance.now() - started) / 1000;
  console.log(
    `recorded ${frameCount} frames in ${wall.toFixed(2)}s (${(frameCount / wall).toFixed(2)} frames/s, ` +
      `present ${(renderMs / frameCount).toFixed(1)}ms, capture ${(captureMs / frameCount).toFixed(1)}ms)`,
  );
  console.log(
    `ffprobe ${probe.width}x${probe.height} ${probe.codec} ${probe.pixFmt} frames=${probe.frames} duration=${probe.duration}`,
  );
  const failures: string[] = [];
  if (probe.width !== VIEW_WIDTH || probe.height !== VIEW_HEIGHT) {
    failures.push(`recording is ${probe.width}x${probe.height}, expected ${VIEW_WIDTH}x${VIEW_HEIGHT}`);
  }
  if (probe.codec !== 'h264') failures.push(`recording codec is ${probe.codec}, expected h264`);
  if (probe.pixFmt !== 'yuv420p') failures.push(`recording pix_fmt is ${probe.pixFmt}, expected yuv420p`);
  if (probe.frames !== frameCount) {
    failures.push(`recording has ${probe.frames} frames, expected ${frameCount}`);
  }
  if (Math.abs(probe.duration - expectedDuration) > 1 / fps) {
    failures.push(`recording duration is ${probe.duration}s, expected ${expectedDuration}s`);
  }
  if (failures.length > 0) {
    for (const failure of failures) console.error(failure);
    throw new CheckError(`record failed (${failures.length})`);
  }
}

interface FfmpegPipe {
  child: ChildProcess;
  stderr: string;
  stdin: NodeJS.WritableStream;
}

function startFfmpeg(out: string, fps: number): FfmpegPipe {
  // A pipe has no file extension for ffmpeg to sniff, so the input codec is set explicitly.
  const child = spawn(
    'ffmpeg',
    [
      '-y',
      '-f',
      'image2pipe',
      '-c:v',
      'png',
      '-framerate',
      String(fps),
      '-i',
      'pipe:0',
      '-an',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-crf',
      '18',
      '-preset',
      'medium',
      '-movflags',
      '+faststart',
      '-r',
      String(fps),
      out,
    ],
    { stdio: ['pipe', 'ignore', 'pipe'] },
  );
  if (!child.stdin || !child.stderr) throw new CheckError('ffmpeg pipe setup failed');
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
    if (stderr.length > 20_000) stderr = stderr.slice(-20_000);
  });
  const pipe: FfmpegPipe = { child, stderr: '', stdin: child.stdin };
  child.once('close', () => {
    pipe.stderr = stderr;
  });
  child.stderr.on('data', () => {
    pipe.stderr = stderr;
  });
  return pipe;
}

async function capturePng(cdp: CDPSession): Promise<Buffer> {
  const shot = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    optimizeForSpeed: true,
  });
  return Buffer.from(shot.data, 'base64');
}

async function writeFrame(ffmpeg: FfmpegPipe, png: Buffer): Promise<void> {
  if (ffmpeg.child.exitCode !== null) {
    throw new CheckError(`ffmpeg exited ${ffmpeg.child.exitCode} early\n${ffmpeg.stderr}`);
  }
  if (!ffmpeg.stdin.write(png)) await once(ffmpeg.stdin, 'drain');
}

async function finishFfmpeg(ffmpeg: FfmpegPipe): Promise<void> {
  ffmpeg.stdin.end();
  const code = await new Promise<number>((resolve, reject) => {
    ffmpeg.child.once('error', reject);
    ffmpeg.child.once('close', (exitCode) => resolve(exitCode ?? 1));
  });
  if (code !== 0) throw new CheckError(`ffmpeg exited ${code}\n${ffmpeg.stderr}`);
}

main().catch(reportFailure);
