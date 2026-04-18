import {
  PhotonImage,
  SamplingFilter,
  resize,
  watermark,
} from '@cf-wasm/photon';

import { planGrid, type Dimensions } from './layout';

export interface GridInput {
  url: string;
  width: number;
  height: number;
}

async function fetchJpegBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url, {
    headers: {
      Accept: 'image/jpeg,image/webp,image/*;q=0.8',
    },
  });
  if (!res.ok) throw new Error(`fetch ${url}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Fetch N carousel image bytes, lay out an optimal grid using their known
 * dimensions, and composite into a single JPEG (quality 80).
 *
 * Memory strategy: we hold all compressed JPEG bytes in memory (~500 KB each,
 * bounded by typical carousel size of ≤10), decode + resize + watermark one
 * at a time, and free the transient PhotonImages immediately. Peak pixel
 * memory ≈ canvas + one source + one resized tile.
 */
export async function composeGrid(items: GridInput[]): Promise<Uint8Array> {
  if (!items.length) throw new Error('composeGrid: no items');

  const buffers = await Promise.all(items.map((i) => fetchJpegBytes(i.url)));

  const dimensions: Dimensions[] = items.map((i) => ({
    width: i.width,
    height: i.height,
  }));
  const plan = planGrid(dimensions);

  const canvasPixels = new Uint8Array(plan.canvasWidth * plan.canvasHeight * 4);
  const canvas = new PhotonImage(
    canvasPixels,
    plan.canvasWidth,
    plan.canvasHeight,
  );

  let y = 0;
  for (const row of plan.rows) {
    let x = 0;
    for (let k = 0; k < row.count; k++) {
      const idx = row.firstIndex + k;
      const src = dimensions[idx]!;
      const tileWidth = Math.max(
        1,
        Math.round((src.width * row.height) / src.height),
      );

      const source = PhotonImage.new_from_byteslice(buffers[idx]!);
      const tile = resize(
        source,
        tileWidth,
        row.height,
        SamplingFilter.Lanczos3,
      );
      source.free();
      watermark(canvas, tile, BigInt(x), BigInt(y));
      tile.free();

      x += tileWidth;
    }
    y += row.height;
  }

  const jpeg = canvas.get_bytes_jpeg(80);
  canvas.free();
  return jpeg;
}
