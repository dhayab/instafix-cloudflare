const MAX_ROW_IMAGES = 3;
const TARGET_ROW_HEIGHT = 1000;
const CANVAS_WIDTH_FACTOR = 1.5;

export interface Dimensions {
  width: number;
  height: number;
}

export interface RowPlan {
  firstIndex: number;
  count: number;
  height: number;
}

export interface GridPlan {
  canvasWidth: number;
  canvasHeight: number;
  rows: RowPlan[];
}

/**
 * For a horizontal strip of images stretched to fill `canvasWidth` while
 * keeping their aspect ratios, returns the common row height.
 */
function rowHeight(slice: Dimensions[], canvasWidth: number): number {
  let aspectSum = 0;
  for (const d of slice) aspectSum += d.width / d.height;
  return canvasWidth / aspectSum;
}

function rowCost(slice: Dimensions[], canvasWidth: number): number {
  const h = rowHeight(slice, canvasWidth);
  const delta = TARGET_ROW_HEIGHT - h;
  return delta * delta;
}

/**
 * Ported from handlers/grid.go. Each node is a "cut position" between images
 * (0..N). An edge i→j means "row = images[i:j]". We pick the min-cost path
 * from 0 to N; each edge's cost penalises rows whose natural height is far
 * from TARGET_ROW_HEIGHT. Rows are limited to MAX_ROW_IMAGES images.
 *
 * The Go original uses Dijkstra via an external library; this is a DAG with
 * out-degree ≤ 3, so a single forward sweep gives the same result.
 */
export function planGrid(images: Dimensions[]): GridPlan {
  const n = images.length;
  if (n === 0) throw new Error('planGrid: no images');

  const avgWidth = images.reduce((s, d) => s + d.width, 0) / n;
  const canvasWidth = Math.round(avgWidth * CANVAS_WIDTH_FACTOR);

  const dist: number[] = Array.from({ length: n + 1 }, () => Infinity);
  const prev: number[] = Array.from({ length: n + 1 }, () => -1);
  dist[0] = 0;

  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(dist[i]!)) continue;
    for (let k = 1; k <= MAX_ROW_IMAGES && i + k <= n; k++) {
      const j = i + k;
      const cost = rowCost(images.slice(i, j), canvasWidth);
      const cand = dist[i]! + cost;
      if (cand < dist[j]!) {
        dist[j] = cand;
        prev[j] = i;
      }
    }
  }

  const breaks: number[] = [];
  for (let cur = n; cur >= 0; cur = prev[cur]!) {
    breaks.unshift(cur);
    if (cur === 0) break;
  }
  if (breaks[0] !== 0) throw new Error('planGrid: unreachable target');

  const rows: RowPlan[] = [];
  let canvasHeight = 0;
  for (let i = 1; i < breaks.length; i++) {
    const start = breaks[i - 1]!;
    const end = breaks[i]!;
    const h = Math.round(rowHeight(images.slice(start, end), canvasWidth));
    rows.push({ firstIndex: start, count: end - start, height: h });
    canvasHeight += h;
  }

  return { canvasWidth, canvasHeight, rows };
}
