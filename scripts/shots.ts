import path from 'node:path';
import {
  VIEW_HEIGHT,
  VIEW_WIDTH,
  CheckError,
  canvasPixel,
  canvasSize,
  countDistinctColors,
  decodePng,
  ensureDir,
  parseFlags,
  pngPixel,
  present,
  reportFailure,
  repoPath,
  withDiorama,
} from './browser.ts';

const SAMPLE_POINTS: readonly [number, number][] = [
  [10, 10],
  [960, 540],
  [1800, 1000],
];

async function main(): Promise<void> {
  const started = performance.now();
  const flags = parseFlags(process.argv.slice(2), ['url', 'times']);
  const times = parseTimes(flags.get('times') ?? '12,41,78');
  const outDir = repoPath('artifacts/screenshots');
  ensureDir(outDir);
  const failures: string[] = [];

  await withDiorama(flags.get('url'), async (page) => {
    const size = await canvasSize(page);
    if (size.width !== VIEW_WIDTH || size.height !== VIEW_HEIGHT) {
      failures.push(`#screen is ${size.width}x${size.height}, expected ${VIEW_WIDTH}x${VIEW_HEIGHT}`);
    }
    const seen = new Set<string>();
    for (const t of times) {
      const name = `shot-t${formatTime(t)}.png`;
      if (seen.has(name)) {
        failures.push(`duplicate screenshot name ${name}`);
        continue;
      }
      seen.add(name);
      const file = path.join(outDir, name);
      await present(page, t);
      await page.screenshot({ path: file, type: 'png' });
      const image = decodePng(file);
      const colors = countDistinctColors(image.rgb);
      console.log(`${name} ${image.width}x${image.height} colors=${colors}`);
      if (image.width !== VIEW_WIDTH || image.height !== VIEW_HEIGHT) {
        failures.push(`${name} is ${image.width}x${image.height}, expected ${VIEW_WIDTH}x${VIEW_HEIGHT}`);
      }
      if (colors <= 16) {
        failures.push(`${name} looks blank (${colors} distinct colors, need more than 16)`);
      }
      for (const [x, y] of SAMPLE_POINTS) {
        if (x >= image.width || y >= image.height) continue;
        const canvas = await canvasPixel(page, x, y);
        const png = pngPixel(image.rgb, image.width, x, y);
        if (canvas[0] !== png[0] || canvas[1] !== png[1] || canvas[2] !== png[2]) {
          failures.push(
            `${name} pixel ${x},${y} is ${png.join(',')} in the png and ${canvas.join(',')} on the canvas`,
          );
        }
      }
    }
  });

  const wall = (performance.now() - started) / 1000;
  console.log(`shots finished in ${wall.toFixed(2)}s`);
  if (failures.length > 0) {
    for (const failure of failures) console.error(failure);
    throw new CheckError(`shots failed (${failures.length})`);
  }
}

function parseTimes(raw: string): number[] {
  const parts = raw.split(',');
  if (parts.length === 0 || raw.trim() === '') {
    throw new CheckError('--times must list at least one time');
  }
  return parts.map((part) => {
    const text = part.trim();
    if (text === '' || !Number.isFinite(Number(text))) {
      throw new CheckError(`--times entry ${part} is not a finite number`);
    }
    return Number(text);
  });
}

function formatTime(t: number): string {
  if (Object.is(t, -0) || t === 0) return '0';
  if (Number.isInteger(t)) return String(t);
  return String(t);
}

main().catch(reportFailure);
