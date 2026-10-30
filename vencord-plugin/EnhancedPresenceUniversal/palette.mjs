export const DEFAULT_PALETTE = Object.freeze({ accent: '#006FE6', foreground: '#FFFFFF' });

function colorHex(r, g, b) {
  return `#${[r, g, b].map(value => Math.round(value).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

function parseHex(value) {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) return null;
  return [1, 3, 5].map(index => Number.parseInt(value.slice(index, index + 2), 16));
}

function linear(value) {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function luminance([r, g, b]) {
  return linear(r) * 0.2126 + linear(g) * 0.7152 + linear(b) * 0.0722;
}

export function contrastRatio(background, foreground) {
  const bg = parseHex(background), fg = parseHex(foreground);
  if (!bg || !fg) return 21;
  const values = [luminance(bg), luminance(fg)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

export function extractAccent(rgba) {
  if (!(rgba instanceof Uint8Array || rgba instanceof Uint8ClampedArray) || rgba.length < 4 || rgba.length % 4 !== 0 || rgba.byteLength > 16384) {
    return DEFAULT_PALETTE;
  }

  const bins = new Map();
  const pixelCount = rgba.length / 4;
  const stride = Math.max(1, Math.ceil(pixelCount / 1024));
  for (let pixel = 0, sampled = 0; pixel < pixelCount && sampled < 1024; pixel += stride, sampled++) {
    const index = pixel * 4;
    const r = rgba[index], g = rgba[index + 1], b = rgba[index + 2];
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    if (rgba[index + 3] < 192 || chroma < 32 || Math.max(r, g, b) < 34 || Math.min(r, g, b) > 244) continue;

    const key = Math.floor(r / 43) * 36 + Math.floor(g / 43) * 6 + Math.floor(b / 43);
    const bin = bins.get(key) ?? { count: 0, r: 0, g: 0, b: 0, chroma: 0 };
    bin.count++;
    bin.r += r;
    bin.g += g;
    bin.b += b;
    bin.chroma += chroma;
    bins.set(key, bin);
  }

  let best;
  let bestScore = 0;
  for (const bin of bins.values()) {
    const score = bin.count * (0.65 + Math.min(1, bin.chroma / bin.count / 192) * 0.35);
    if (score > bestScore) { best = bin; bestScore = score; }
  }
  if (!best) return DEFAULT_PALETTE;

  const accent = colorHex(best.r / best.count, best.g / best.count, best.b / best.count);
  const foreground = contrastRatio(accent, '#FFFFFF') >= contrastRatio(accent, '#000000') ? '#FFFFFF' : '#000000';
  return { accent, foreground };
}
