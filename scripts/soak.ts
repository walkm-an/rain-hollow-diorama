import path from 'node:path';
import { writeFileSync } from 'node:fs';
import type { CDPSession, Page } from 'puppeteer-core';
import {
  CheckError,
  ensureDir,
  parseFlags,
  positiveFlag,
  readInfo,
  reportFailure,
  repoPath,
  statsFrames,
  withDiorama,
} from './browser.ts';

const CHUNK_FRAMES = 600;
const SAMPLE_SECONDS = 5;
const FRAME_DT = 1 / 60;
const HEAP_GROWTH_LIMIT = 2 * 1024 * 1024;

interface Sample {
  wallSeconds: number;
  simulatedSeconds: number;
  frames: number;
  loops: number;
  particles: number;
  heapUsed: number;
  jsHeapUsed: number;
  nodes: number;
  listeners: number;
  renderP50Ms: number;
  renderP95Ms: number;
  warmup: boolean;
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2), ['url', 'seconds']);
  const seconds = positiveFlag(flags, 'seconds', 330);
  const failures: string[] = [];
  let report: Record<string, unknown> = {};
  const samples: Sample[] = [];

  await withDiorama(flags.get('url'), async (page, cdp) => {
    const info = await readInfo(page);
    const framesPerLoop = info.loopSeconds / FRAME_DT;
    const roundedLoop = Math.round(framesPerLoop);
    if (Math.abs(framesPerLoop - roundedLoop) > 1e-6) {
      throw new CheckError(`loopSeconds ${info.loopSeconds} is not a whole number of 1/60 frames`);
    }
    const framesBefore = await statsFrames(page);
    const started = performance.now();
    let frame = 0;
    let nextSampleAt = 0;
    let sawWarmup = false;
    let sawPostWarmup = false;
    let renderSumMs = 0;
    const particles: ParticleTally = {
      min: Number.POSITIVE_INFINITY,
      max: Number.NEGATIVE_INFINITY,
      last: 0,
      mismatches: 0,
      compared: 0,
    };
    const phaseParticles = new Map<number, number>();
    let windowTimes: number[] = [];

    while (!sawPostWarmup || (performance.now() - started) / 1000 < seconds) {
      const chunk = await runChunk(page, frame, CHUNK_FRAMES, roundedLoop, info.loopSeconds);
      tallyParticles(frame, chunk.particles, roundedLoop, phaseParticles, particles);
      renderSumMs += chunk.times.reduce((sum, time) => sum + time, 0);
      windowTimes.push(...chunk.times);
      frame += chunk.particles.length;
      const elapsed = (performance.now() - started) / 1000;
      if (!sawWarmup || elapsed >= nextSampleAt || elapsed >= seconds) {
        const heap = await readHeap(cdp);
        // The first GC sample includes JIT warmup. The growth gate starts at the next sample.
        const warmup = !sawWarmup;
        const sample: Sample = {
          wallSeconds: elapsed,
          simulatedSeconds: frame * FRAME_DT,
          frames: frame,
          loops: (frame * FRAME_DT) / info.loopSeconds,
          particles: particles.last,
          heapUsed: heap.used,
          jsHeapUsed: heap.jsHeap,
          nodes: heap.nodes,
          listeners: heap.listeners,
          renderP50Ms: percentile(windowTimes, 50),
          renderP95Ms: percentile(windowTimes, 95),
          warmup,
        };
        samples.push(sample);
        windowTimes = [];
        console.log(
          `soak wall=${sample.wallSeconds.toFixed(1)}s sim=${sample.simulatedSeconds.toFixed(1)}s ` +
            `frames=${sample.frames} heap=${(sample.heapUsed / (1024 * 1024)).toFixed(2)}MB ` +
            `particles=${sample.particles} nodes=${sample.nodes}${warmup ? ' warmup' : ''}`,
        );
        if (warmup) sawWarmup = true;
        else sawPostWarmup = true;
        nextSampleAt = elapsed + SAMPLE_SECONDS;
      }
    }

    const framesAfter = await statsFrames(page);
    const wallSeconds = (performance.now() - started) / 1000;
    const simulatedSeconds = frame * FRAME_DT;
    const post = samples.filter((sample) => !sample.warmup);
    const first = post[0];
    const last = post[post.length - 1];
    if (!first || !last) throw new CheckError('soak produced no post-warmup heap sample');
    const growth = last.heapUsed - first.heapUsed;
    const slope = slopeKbPerSimHour(post);
    const meanRenderMs = frame === 0 ? 0 : renderSumMs / frame;
    if (framesAfter - framesBefore !== frame) {
      failures.push(
        `stats().frames moved by ${framesAfter - framesBefore}, expected ${frame} simulated frames`,
      );
    }
    if (growth > HEAP_GROWTH_LIMIT) {
      failures.push(
        `heap after GC grew by ${growth} bytes, from ${first.heapUsed} to ${last.heapUsed}, limit ${HEAP_GROWTH_LIMIT}`,
      );
    }
    if (particles.mismatches > 0) {
      failures.push(`particle phase mismatches ${particles.mismatches}`);
    }
    if (simulatedSeconds >= info.loopSeconds * 2 && particles.compared === 0) {
      failures.push('simulated at least two loops but never compared a repeated phase');
    }
    if (last.nodes > first.nodes) {
      failures.push(`DOM nodes grew from ${first.nodes} to ${last.nodes}`);
    }
    const heapMax = post.reduce((max, sample) => Math.max(max, sample.heapUsed), first.heapUsed);

    report = {
      secondsRequested: seconds,
      wallSeconds,
      simulatedSeconds,
      frames: frame,
      loops: simulatedSeconds / info.loopSeconds,
      speedup: wallSeconds === 0 ? 0 : simulatedSeconds / wallSeconds,
      render: {
        meanMs: meanRenderMs,
        shareOfWall: wallSeconds === 0 ? 0 : renderSumMs / 1000 / wallSeconds,
        boundSpeedup: meanRenderMs === 0 ? 0 : 1000 / meanRenderMs / 60,
      },
      heap: {
        warmup: samples.find((sample) => sample.warmup)?.heapUsed ?? null,
        firstPostWarmup: first.heapUsed,
        last: last.heapUsed,
        max: heapMax,
        growthBytes: growth,
        slopeKbPerSimHour: slope,
        limitBytes: HEAP_GROWTH_LIMIT,
      },
      particles: {
        min: particles.min,
        max: particles.max,
        phaseMismatches: particles.mismatches,
        phasesCompared: particles.compared,
      },
      nodes: { first: first.nodes, last: last.nodes },
      listeners: { first: first.listeners, last: last.listeners },
      jsHeap: { first: first.jsHeapUsed, last: last.jsHeapUsed },
      statsFrames: { before: framesBefore, after: framesAfter },
      samples: samples.length,
      failures,
    };
  });

  const jsonPath = repoPath('artifacts/soak-report.json');
  const csvPath = repoPath('artifacts/soak-samples.csv');
  const mdPath = repoPath('artifacts/soak-report.md');
  ensureDir(path.dirname(jsonPath));
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(csvPath, renderCsv(samples));
  writeFileSync(mdPath, renderMarkdown(report));
  console.log(`wrote ${jsonPath}`);
  console.log(`wrote ${csvPath}`);
  console.log(`wrote ${mdPath}`);
  if (failures.length > 0) {
    for (const failure of failures) console.error(failure);
    throw new CheckError(`soak failed (${failures.length})`);
  }
}

interface ParticleTally {
  min: number;
  max: number;
  last: number;
  mismatches: number;
  compared: number;
}

function tallyParticles(
  startFrame: number,
  counts: number[],
  framesPerLoop: number,
  seen: Map<number, number>,
  tally: ParticleTally,
): void {
  for (let i = 0; i < counts.length; i++) {
    const count = counts[i];
    if (typeof count !== 'number' || !Number.isFinite(count)) {
      throw new CheckError(`particle count at frame ${startFrame + i} is not a finite number`);
    }
    tally.last = count;
    if (count < tally.min) tally.min = count;
    if (count > tally.max) tally.max = count;
    const phase = (startFrame + i) % framesPerLoop;
    const prior = seen.get(phase);
    if (prior === undefined) seen.set(phase, count);
    else {
      tally.compared++;
      if (prior !== count) tally.mismatches++;
    }
  }
}

async function runChunk(
  page: Page,
  startFrame: number,
  count: number,
  framesPerLoop: number,
  loopSeconds: number,
): Promise<{ particles: number[]; times: number[] }> {
  const raw = await page.evaluate(
    (start: number, frames: number, framesPerLoop: number, loopSeconds: number) => {
      const api = window.__diorama;
      if (!api) throw new Error('window.__diorama is missing');
      const particles: number[] = [];
      const times: number[] = [];
      for (let i = 0; i < frames; i++) {
        // i/60 drifts off the loop phase after one period. Keep the in-loop frame and add whole loops.
        const absolute = start + i;
        const frameInLoop = absolute % framesPerLoop;
        const loopIndex = Math.floor(absolute / framesPerLoop);
        const t = frameInLoop / 60 + loopIndex * loopSeconds;
        const before = performance.now();
        const stats = api.renderAt(t);
        times.push(performance.now() - before);
        particles.push(stats.particles);
      }
      return { particles, times };
    },
    startFrame,
    count,
    framesPerLoop,
    loopSeconds,
  );
  return parseChunk(raw, count);
}

function parseChunk(raw: unknown, count: number): { particles: number[]; times: number[] } {
  if (typeof raw !== 'object' || raw === null) {
    throw new CheckError('soak chunk returned an unexpected shape');
  }
  const row = new Map(Object.entries(raw));
  return {
    particles: numberList(row.get('particles'), count, 'particles'),
    times: numberList(row.get('times'), count, 'times'),
  };
}

function numberList(value: unknown, count: number, label: string): number[] {
  if (!Array.isArray(value) || value.length !== count) {
    const actual = Array.isArray(value) ? String(value.length) : 'not an array';
    throw new CheckError(`soak chunk ${label} length is ${actual}, expected ${count}`);
  }
  const out: number[] = [];
  for (const item of value) {
    if (typeof item !== 'number' || !Number.isFinite(item)) {
      throw new CheckError(`soak chunk ${label} contains a non-finite value`);
    }
    out.push(item);
  }
  return out;
}

async function readHeap(cdp: CDPSession): Promise<{ used: number; jsHeap: number; nodes: number; listeners: number }> {
  await cdp.send('HeapProfiler.collectGarbage');
  const heap = await cdp.send('Runtime.getHeapUsage');
  const metrics = await cdp.send('Performance.getMetrics');
  const byName = new Map(metrics.metrics.map((metric) => [metric.name, metric.value]));
  const jsHeap = byName.get('JSHeapUsedSize');
  const nodes = byName.get('Nodes');
  const listeners = byName.get('JSEventListeners');
  if (jsHeap === undefined || nodes === undefined || listeners === undefined) {
    throw new CheckError('Performance.getMetrics is missing JSHeapUsedSize, Nodes, or JSEventListeners');
  }
  return { used: heap.usedSize, jsHeap, nodes, listeners };
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) throw new CheckError('percentile of an empty sample');
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}

function slopeKbPerSimHour(samples: Sample[]): number {
  const n = samples.length;
  if (n < 2) return 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const sample of samples) {
    sx += sample.simulatedSeconds;
    sy += sample.heapUsed;
    sxx += sample.simulatedSeconds * sample.simulatedSeconds;
    sxy += sample.simulatedSeconds * sample.heapUsed;
  }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return 0;
  const bytesPerSecond = (n * sxy - sx * sy) / denom;
  return (bytesPerSecond * 3600) / 1024;
}

function renderCsv(samples: Sample[]): string {
  const header = [
    'wall_s',
    'simulated_s',
    'frames',
    'loops',
    'particles',
    'heap_used',
    'js_heap_used',
    'nodes',
    'listeners',
    'render_p50_ms',
    'render_p95_ms',
    'warmup',
  ];
  const lines = [header.join(',')];
  for (const sample of samples) {
    lines.push(
      [
        sample.wallSeconds.toFixed(3),
        sample.simulatedSeconds.toFixed(3),
        sample.frames,
        sample.loops.toFixed(4),
        sample.particles,
        sample.heapUsed,
        sample.jsHeapUsed,
        sample.nodes,
        sample.listeners,
        sample.renderP50Ms.toFixed(4),
        sample.renderP95Ms.toFixed(4),
        sample.warmup ? 1 : 0,
      ].join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

function renderMarkdown(report: Record<string, unknown>): string {
  const heap = field(report, 'heap');
  const particles = field(report, 'particles');
  const nodes = field(report, 'nodes');
  const render = field(report, 'render');
  const failures = Array.isArray(report.failures) ? report.failures.map(String) : [];
  const lines = [
    '# Soak report',
    '',
    '| Measure | Value |',
    '| --- | --- |',
    `| Wall seconds | ${fmt(num(report.wallSeconds))} |`,
    `| Simulated seconds | ${fmt(num(report.simulatedSeconds))} |`,
    `| Loops | ${fmt(num(report.loops))} |`,
    `| Frames | ${fmt(num(report.frames))} |`,
    `| Speedup vs realtime | ${fmt(num(report.speedup))} |`,
    `| Mean render ms | ${fmt(num(render.meanMs))} |`,
    `| Render share of wall | ${fmt(num(render.shareOfWall))} |`,
    `| Heap first / last / max bytes | ${fmt(num(heap.firstPostWarmup))} / ${fmt(num(heap.last))} / ${fmt(num(heap.max))} |`,
    `| Heap growth bytes | ${fmt(num(heap.growthBytes))} |`,
    `| Heap slope KB per simulated hour | ${fmt(num(heap.slopeKbPerSimHour))} |`,
    `| Particles min / max | ${fmt(num(particles.min))} / ${fmt(num(particles.max))} |`,
    `| Phase mismatches | ${fmt(num(particles.phaseMismatches))} |`,
    `| Phases compared | ${fmt(num(particles.phasesCompared))} |`,
    `| DOM nodes first / last | ${fmt(num(nodes.first))} / ${fmt(num(nodes.last))} |`,
    '',
    'The first GC sample is warmup. Growth, slope, and the node gate use the later samples.',
    'p50 and p95 in the CSV cover the frames since the previous sample.',
    '',
  ];
  if (failures.length === 0) lines.push('No failures.');
  else {
    lines.push('Failures.');
    lines.push('');
    for (const failure of failures) lines.push(`- ${failure}`);
  }
  lines.push('');
  return lines.join('\n');
}

function field(report: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = report[key];
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value));
  }
  return {};
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function fmt(n: number): string {
  if (Number.isInteger(n)) return n.toString();
  return n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

main().catch(reportFailure);
