import path from 'node:path';
import { writeFileSync } from 'node:fs';
import type { Page } from 'puppeteer-core';
import {
  VIEW_HEIGHT,
  VIEW_WIDTH,
  CheckError,
  canvasPixel,
  canvasSize,
  countDifferingPixels,
  decodePng,
  diffAt,
  ensureDir,
  hashAt,
  parseFlags,
  pngPixel,
  present,
  readInfo,
  reportFailure,
  repoPath,
  withDiorama,
  type FrameDiff,
} from './browser.ts';

const TEN_HOURS = 36000;
const SAMPLE_POINTS: readonly [number, number][] = [
  [10, 10],
  [960, 540],
  [1800, 1000],
];

interface StepSample {
  x: number;
  changedPixels: number;
  meanAbsDelta: number;
  maxChannelDelta: number;
}

interface Distribution {
  median: number;
  p95: number;
  max: number;
}

async function main(): Promise<void> {
  const started = performance.now();
  const flags = parseFlags(process.argv.slice(2), ['url']);
  const failures: string[] = [];
  let report: Record<string, unknown> = {};

  await withDiorama(flags.get('url'), async (page) => {
    const info = await readInfo(page);
    const expectedPixels = info.width * info.height;
    const loop = info.loopSeconds;
    const dt = 1 / 60;

    const atZero = await diffAt(page, 0, loop);
    noteDiff(`diff(0, ${fmt(loop)})`, atZero, expectedPixels, failures);
    if (atZero.changedPixels !== 0) {
      failures.push(`diff(0, ${fmt(loop)}) changed ${atZero.changedPixels} pixels, expected 0`);
    }

    const closure: { x: number; diff: FrameDiff }[] = [];
    for (const x of spread(10, loop)) {
      const row = await diffAt(page, x, x + loop);
      noteDiff(`diff(${fmt(x)}, ${fmt(x + loop)})`, row, expectedPixels, failures);
      if (row.changedPixels !== 0) {
        failures.push(`diff(${fmt(x)}, ${fmt(x + loop)}) changed ${row.changedPixels} pixels, expected 0`);
      }
      closure.push({ x, diff: row });
    }
    console.log(`closure checks ${closure.length + 1}, failures so far ${failures.length}`);

    // Scroll ticks last one frame, so a one-second grid misses them and the max becomes an accident of phase.
    console.log('scanning every 1/60 step inside the loop');
    const ordinary = await ordinarySteps(page, loop, dt, expectedPixels);

    const changedStats = distribution(ordinary.map((step) => step.changedPixels));
    const meanStats = distribution(ordinary.map((step) => step.meanAbsDelta));
    const seam = await diffAt(page, loop - dt, loop);
    noteDiff(`seam diff(${fmt(loop - dt)}, ${fmt(loop)})`, seam, expectedPixels, failures);
    console.log(
      `seam changedPixels=${seam.changedPixels} meanAbsDelta=${fmt(seam.meanAbsDelta)} ` +
        `ordinary max changedPixels=${changedStats.max} meanAbsDelta=${fmt(meanStats.max)}`,
    );
    if (seam.changedPixels > changedStats.max) {
      failures.push(
        `seam changedPixels ${seam.changedPixels} exceeds ordinary max ${changedStats.max}`,
      );
    }
    if (exceeds(seam.meanAbsDelta, meanStats.max)) {
      failures.push(
        `seam meanAbsDelta ${fmt(seam.meanAbsDelta)} exceeds ordinary max ${fmt(meanStats.max)}`,
      );
    }

    const longXs = [0, dt, 41, 97.5, loop / 2];
    const longRun: { k: number; x: number; diff: FrameDiff }[] = [];
    for (const k of [1, 30, 300]) {
      for (const x of longXs) {
        const row = await diffAt(page, x, x + k * loop);
        noteDiff(`diff(${fmt(x)}, ${fmt(x + k * loop)})`, row, expectedPixels, failures);
        if (row.changedPixels !== 0) {
          failures.push(
            `diff(${fmt(x)}, ${fmt(x)} + ${k} loops) changed ${row.changedPixels} pixels, expected 0`,
          );
        }
        longRun.push({ k, x, diff: row });
      }
    }

    const hash0 = await hashAt(page, 0);
    const hashTen = await hashAt(page, TEN_HOURS);
    console.log(`hash(0)=${hash0} hash(${TEN_HOURS})=${hashTen}`);
    if (hash0 !== hashTen) {
      failures.push(`hash(0) is ${hash0} and hash(${TEN_HOURS}) is ${hashTen}`);
    }

    const size = await canvasSize(page);
    if (size.width !== VIEW_WIDTH || size.height !== VIEW_HEIGHT) {
      failures.push(`#screen is ${size.width}x${size.height}, expected ${VIEW_WIDTH}x${VIEW_HEIGHT}`);
    }
    const loopDir = repoPath('artifacts/loop');
    ensureDir(loopDir);
    const file0 = path.join(loopDir, 't0000.png');
    const fileLoop = path.join(loopDir, `t${padSeconds(loop)}.png`);
    await present(page, 0);
    await page.screenshot({ path: file0, type: 'png' });
    const png0 = decodePng(file0);
    await notePng('t=0', file0, png0, page, failures);
    await present(page, loop);
    await page.screenshot({ path: fileLoop, type: 'png' });
    const pngLoop = decodePng(fileLoop);
    await notePng(`t=${fmt(loop)}`, fileLoop, pngLoop, page, failures);
    const differing =
      png0.rgb.length === pngLoop.rgb.length ? countDifferingPixels(png0.rgb, pngLoop.rgb) : -1;
    if (png0.width !== pngLoop.width || png0.height !== pngLoop.height) {
      failures.push(
        `screenshot sizes differ, ${png0.width}x${png0.height} vs ${pngLoop.width}x${pngLoop.height}`,
      );
    } else if (differing !== 0) {
      failures.push(`screenshot t=0 and t=${fmt(loop)} differ by ${differing} pixels, expected 0`);
    }
    console.log(`screenshot differing pixels ${differing}`);

    report = {
      width: info.width,
      height: info.height,
      loopSeconds: loop,
      totalPixels: expectedPixels,
      closure: {
        atZero,
        offsets: closure,
      },
      seam: {
        dt,
        from: loop - dt,
        to: loop,
        diff: seam,
      },
      ordinary: {
        samples: ordinary.length,
        changedPixels: changedStats,
        meanAbsDelta: meanStats,
        steps: ordinary,
      },
      longRun,
      hash: { t0: hash0, t36000: hashTen, equal: hash0 === hashTen },
      screenshot: {
        t0: path.relative(repoPath('.'), file0),
        tLoop: path.relative(repoPath('.'), fileLoop),
        width: png0.width,
        height: png0.height,
        differingPixels: differing,
      },
      failures,
    };
  });

  const jsonPath = repoPath('artifacts/loop-report.json');
  const mdPath = repoPath('artifacts/loop-report.md');
  ensureDir(path.dirname(jsonPath));
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(mdPath, renderMarkdown(report));
  const wall = (performance.now() - started) / 1000;
  console.log(`loop check finished in ${wall.toFixed(2)}s`);
  console.log(`wrote ${jsonPath}`);
  console.log(`wrote ${mdPath}`);
  if (failures.length > 0) {
    for (const failure of failures) console.error(failure);
    throw new CheckError(`loop check failed (${failures.length})`);
  }
}

async function ordinarySteps(
  page: Page,
  loop: number,
  dt: number,
  expectedPixels: number,
): Promise<StepSample[]> {
  const raw = await page.evaluate((period: number, step: number, pixels: number) => {
    const api = window.__diorama;
    if (!api) throw new Error('window.__diorama is missing');
    const frames = Math.round(period / step);
    const out: StepSample[] = [];
    for (let i = 0; i < frames - 1; i++) {
      const x = i / 60;
      const row = api.diff(x, x + step);
      if (row.totalPixels !== pixels) {
        throw new Error(`ordinary diff totalPixels is ${row.totalPixels}, expected ${pixels}`);
      }
      if (row.changedPixels < 0 || row.changedPixels > row.totalPixels) {
        throw new Error(`ordinary diff changedPixels ${row.changedPixels} is outside 0..${row.totalPixels}`);
      }
      out.push({
        x,
        changedPixels: row.changedPixels,
        meanAbsDelta: row.meanAbsDelta,
        maxChannelDelta: row.maxChannelDelta,
      });
    }
    return out;
  }, loop, dt, expectedPixels);
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new CheckError('ordinary step scan returned no samples');
  }
  return raw.map((row) => {
    if (!isStep(row)) throw new CheckError('ordinary step scan returned an unexpected shape');
    return row;
  });
}

function isStep(value: unknown): value is StepSample {
  if (typeof value !== 'object' || value === null) return false;
  if (!('x' in value) || !('changedPixels' in value) || !('meanAbsDelta' in value) || !('maxChannelDelta' in value)) {
    return false;
  }
  return (
    typeof value.x === 'number' &&
    typeof value.changedPixels === 'number' &&
    typeof value.meanAbsDelta === 'number' &&
    typeof value.maxChannelDelta === 'number'
  );
}

function spread(count: number, loop: number): number[] {
  const xs: number[] = [];
  for (let i = 0; i < count; i++) xs.push(((i + 0.5) * loop) / count);
  return xs;
}

function noteDiff(label: string, diff: FrameDiff, expectedPixels: number, failures: string[]): void {
  if (diff.totalPixels !== expectedPixels) {
    failures.push(`${label} totalPixels is ${diff.totalPixels}, expected ${expectedPixels}`);
  }
  if (diff.changedPixels < 0 || diff.changedPixels > diff.totalPixels) {
    failures.push(`${label} changedPixels ${diff.changedPixels} is outside 0..${diff.totalPixels}`);
  }
}

async function notePng(
  label: string,
  file: string,
  image: { width: number; height: number; rgb: Buffer },
  page: Parameters<typeof canvasPixel>[0],
  failures: string[],
): Promise<void> {
  if (image.width !== VIEW_WIDTH || image.height !== VIEW_HEIGHT) {
    failures.push(`${label} screenshot is ${image.width}x${image.height}, expected ${VIEW_WIDTH}x${VIEW_HEIGHT}`);
  }
  for (const [x, y] of SAMPLE_POINTS) {
    if (x >= image.width || y >= image.height) continue;
    const canvas = await canvasPixel(page, x, y);
    const png = pngPixel(image.rgb, image.width, x, y);
    if (canvas[0] !== png[0] || canvas[1] !== png[1] || canvas[2] !== png[2]) {
      failures.push(
        `${path.basename(file)} pixel ${x},${y} is ${png.join(',')} in the png and ${canvas.join(',')} on the canvas`,
      );
    }
  }
}

function distribution(values: number[]): Distribution {
  if (values.length === 0) return { median: 0, p95: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    median: rank(sorted, 50),
    p95: rank(sorted, 95),
    max: sorted[sorted.length - 1] ?? 0,
  };
}

function rank(sorted: number[], p: number): number {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}

function exceeds(actual: number, limit: number): boolean {
  const scale = Math.max(1, Math.abs(limit));
  return actual > limit + scale * 1e-9;
}

function padSeconds(loop: number): string {
  return String(Math.round(loop)).padStart(4, '0');
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Number.isInteger(n)) return n.toString();
  return n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

function renderMarkdown(report: Record<string, unknown>): string {
  const closure = record(report.closure);
  const atZero = record(closure.atZero);
  const offsets = Array.isArray(closure.offsets) ? closure.offsets : [];
  const seam = record(report.seam);
  const seamDiff = record(seam.diff);
  const ordinary = record(report.ordinary);
  const changed = record(ordinary.changedPixels);
  const mean = record(ordinary.meanAbsDelta);
  const hash = record(report.hash);
  const shot = record(report.screenshot);
  const failures = Array.isArray(report.failures) ? report.failures.map(String) : [];
  const worstClosure = offsets.reduce((max, row) => {
    const diff = record(record(row).diff);
    return Math.max(max, numberValue(diff.changedPixels));
  }, numberValue(atZero.changedPixels));
  const lines = [
    '# Loop report',
    '',
    `Internal buffer ${numberValue(report.width)} by ${numberValue(report.height)}. Loop ${fmt(numberValue(report.loopSeconds))} seconds.`,
    '',
    '| Check | changedPixels | meanAbsDelta | Result |',
    '| --- | --- | --- | --- |',
    `| diff(0, loop) | ${fmt(numberValue(atZero.changedPixels))} | ${fmt(numberValue(atZero.meanAbsDelta))} | ${numberValue(atZero.changedPixels) === 0 ? 'pass' : 'fail'} |`,
    `| worst of ${offsets.length} offsets | ${fmt(worstClosure)} | | ${worstClosure === 0 ? 'pass' : 'fail'} |`,
    `| seam step | ${fmt(numberValue(seamDiff.changedPixels))} | ${fmt(numberValue(seamDiff.meanAbsDelta))} | ${failures.some((item) => item.startsWith('seam ')) ? 'fail' : 'pass'} |`,
    `| ordinary median / p95 / max | ${fmt(numberValue(changed.median))} / ${fmt(numberValue(changed.p95))} / ${fmt(numberValue(changed.max))} | ${fmt(numberValue(mean.median))} / ${fmt(numberValue(mean.p95))} / ${fmt(numberValue(mean.max))} | |`,
    `| hash(0) vs hash(36000) | | | ${hash.equal === true ? 'pass' : 'fail'} |`,
    `| screenshot differing pixels | ${fmt(numberValue(shot.differingPixels))} | | ${numberValue(shot.differingPixels) === 0 ? 'pass' : 'fail'} |`,
    '',
    `hash(0) = ${String(hash.t0 ?? '')}`,
    '',
    `hash(36000) = ${String(hash.t36000 ?? '')}`,
    '',
  ];
  const longRun = Array.isArray(report.longRun) ? report.longRun : [];
  lines.push('| Loops ahead | Offsets | Max changedPixels |');
  lines.push('| --- | --- | --- |');
  for (const k of [1, 30, 300]) {
    const rows = longRun.filter((row) => numberValue(record(row).k) === k);
    const maxChanged = rows.reduce((max, row) => Math.max(max, numberValue(record(record(row).diff).changedPixels)), 0);
    lines.push(`| ${k} | ${rows.length} | ${fmt(maxChanged)} |`);
  }
  lines.push('');
  if (failures.length === 0) {
    lines.push('No failures.');
  } else {
    lines.push('Failures.');
    lines.push('');
    for (const failure of failures) lines.push(`- ${failure}`);
  }
  lines.push('');
  return lines.join('\n');
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value));
  }
  return {};
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

main().catch(reportFailure);
