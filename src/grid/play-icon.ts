/**
 * Overlays a centered "play" icon (translucent dark circle + white triangle)
 * onto an RGBA pixel buffer in-place. Used on thumbnail cards for videos
 * that exceed Telegram's 20 MB preview limit so the user has a visual cue
 * that the underlying post is still video content.
 */
export function drawPlayIcon(
  pixels: Uint8Array,
  width: number,
  height: number,
): void {
  const cx = width / 2;
  const cy = height / 2;
  const minDim = Math.min(width, height);
  const radius = minDim * 0.16;
  const triRadius = radius * 0.55;

  // Equilateral triangle pointing right, optically centered in the circle.
  // Optical offset shifts the geometric centroid left so the visual centroid
  // lands on the circle's center (~= one-quarter of the base edge length).
  const opticalShift = triRadius * 0.2;
  const apexX = cx + triRadius - opticalShift;
  const apexY = cy;
  const topX = cx - triRadius * 0.5 - opticalShift;
  const topY = cy - triRadius * 0.866;
  const botX = cx - triRadius * 0.5 - opticalShift;
  const botY = cy + triRadius * 0.866;

  const minX = Math.max(0, Math.floor(cx - radius) - 1);
  const maxX = Math.min(width, Math.ceil(cx + radius) + 1);
  const minY = Math.max(0, Math.floor(cy - radius) - 1);
  const maxY = Math.min(height, Math.ceil(cy + radius) + 1);

  const circleAlpha = 0.62;

  for (let y = minY; y < maxY; y++) {
    for (let x = minX; x < maxX; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > radius + 1) continue;

      const idx = (y * width + x) * 4;

      // Antialiased circle coverage at the edge: full coverage inside, linear
      // falloff in the outer ~1 px band.
      const circleCoverage =
        dist <= radius - 1 ? 1 : Math.max(0, radius + 1 - dist) / 2;

      if (circleCoverage > 0) {
        const a = circleAlpha * circleCoverage;
        const inv = 1 - a;
        pixels[idx] = Math.round(pixels[idx]! * inv);
        pixels[idx + 1] = Math.round(pixels[idx + 1]! * inv);
        pixels[idx + 2] = Math.round(pixels[idx + 2]! * inv);
      }

      // Triangle: opaque white inside the three edges.
      if (pointInTriangle(x, y, apexX, apexY, topX, topY, botX, botY)) {
        pixels[idx] = 255;
        pixels[idx + 1] = 255;
        pixels[idx + 2] = 255;
      }
    }
  }
}

function pointInTriangle(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): boolean {
  const d1 = sign(px, py, ax, ay, bx, by);
  const d2 = sign(px, py, bx, by, cx, cy);
  const d3 = sign(px, py, cx, cy, ax, ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function sign(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  return (px - bx) * (ay - by) - (ax - bx) * (py - by);
}
