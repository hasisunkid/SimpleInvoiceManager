import { Resvg } from '@resvg/resvg-js';
import { FONT_FILES } from '../pdf/fonts.js';

/** FR-STYLE-01: logo upload limits. */
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
export const MAX_LOGO_PIXELS_PER_SIDE = 4000;
/** SVG logos are rasterized to this size on the longer side (crisp at ~ 10 cm in print). */
const SVG_RASTER_SIZE = 1200;
const MAX_ASPECT_RATIO = 12;

export type LogoErrorCode = 'LOGO_INVALID_TYPE' | 'LOGO_INVALID' | 'LOGO_DIMENSIONS';

export class LogoError extends Error {
  constructor(readonly code: LogoErrorCode) {
    super(code);
    this.name = 'LogoError';
  }
}

export interface ProcessedLogo {
  data: Buffer;
  mimeType: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
}

type Kind = 'png' | 'jpeg' | 'svg';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Detects the real type from the content (NFR-SEC-01) – the declared Content-Type is ignored. */
export function sniff(data: Buffer): Kind | null {
  if (data.length >= 24 && data.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png';
  if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpeg';
  const head = data
    .subarray(0, 1024)
    .toString('utf8')
    .replace(/^\uFEFF/, '')
    .trimStart();
  // Optional XML declaration, comments and DOCTYPE before <svg> (a DOCTYPE is rejected later).
  const svgStart =
    /^(<\?xml[^>]*\?>\s*)?((<!--[\s\S]*?-->|<!DOCTYPE[^[>]*(\[[\s\S]*?\])?\s*>)\s*)*<svg[\s>]/i;
  if (svgStart.test(head)) return 'svg';
  return null;
}

/** Width/height from the PNG IHDR chunk, without decoding pixels. */
export function pngSize(data: Buffer): { width: number; height: number } {
  if (data.subarray(12, 16).toString('latin1') !== 'IHDR') throw new LogoError('LOGO_INVALID');
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

/** Width/height from the first JPEG SOFn segment, without decoding pixels. */
export function jpegSize(data: Buffer): { width: number; height: number } {
  let offset = 2;
  while (offset + 9 < data.length) {
    if (data[offset] !== 0xff) throw new LogoError('LOGO_INVALID');
    const marker = data[offset + 1]!;
    if (marker === 0xff) {
      offset += 1; // fill byte
      continue;
    }
    const length = data.readUInt16BE(offset + 2);
    const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isSof) {
      return { height: data.readUInt16BE(offset + 5), width: data.readUInt16BE(offset + 7) };
    }
    if (length < 2) throw new LogoError('LOGO_INVALID');
    offset += 2 + length;
  }
  throw new LogoError('LOGO_INVALID');
}

function checkDimensions({ width, height }: { width: number; height: number }): void {
  if (width < 1 || height < 1) throw new LogoError('LOGO_INVALID');
  if (width > MAX_LOGO_PIXELS_PER_SIDE || height > MAX_LOGO_PIXELS_PER_SIDE) {
    // Checked before decoding: a 2 MB file could otherwise unpack to gigabytes (Pi: ≤ 512 MB).
    throw new LogoError('LOGO_DIMENSIONS');
  }
}

/**
 * SVG is never stored or embedded as SVG: it is rasterized to PNG, which removes scripts,
 * event handlers and external references for good (NFR-SEC-01 "SVG sanitising").
 */
function rasterizeSvg(data: Buffer): ProcessedLogo {
  const svg = data.toString('utf8');
  // No DTDs (entity expansion) and no external resources; inline data: images are fine.
  if (/<!DOCTYPE|<!ENTITY/i.test(svg)) throw new LogoError('LOGO_INVALID');
  if (/\bhref\s*=\s*["']\s*(?!data:|#)/i.test(svg)) throw new LogoError('LOGO_INVALID');

  let resvg: Resvg;
  try {
    resvg = new Resvg(svg, {
      font: { loadSystemFonts: false, fontFiles: FONT_FILES, defaultFontFamily: 'Roboto' },
      background: 'rgba(0,0,0,0)',
    });
  } catch {
    throw new LogoError('LOGO_INVALID');
  }
  const { width, height } = resvg;
  if (!(width > 0 && height > 0)) throw new LogoError('LOGO_INVALID');
  if (width / height > MAX_ASPECT_RATIO || height / width > MAX_ASPECT_RATIO) {
    throw new LogoError('LOGO_DIMENSIONS');
  }
  const fitTo =
    width >= height
      ? ({ mode: 'width', value: SVG_RASTER_SIZE } as const)
      : ({ mode: 'height', value: SVG_RASTER_SIZE } as const);
  const rendered = new Resvg(svg, {
    font: { loadSystemFonts: false, fontFiles: FONT_FILES, defaultFontFamily: 'Roboto' },
    background: 'rgba(0,0,0,0)',
    fitTo,
  }).render();
  return {
    data: rendered.asPng(),
    mimeType: 'image/png',
    width: rendered.width,
    height: rendered.height,
  };
}

export function processLogo(data: Buffer): ProcessedLogo {
  if (data.length > MAX_LOGO_BYTES) throw new LogoError('LOGO_DIMENSIONS');
  switch (sniff(data)) {
    case 'png': {
      const size = pngSize(data);
      checkDimensions(size);
      return { data, mimeType: 'image/png', ...size };
    }
    case 'jpeg': {
      const size = jpegSize(data);
      checkDimensions(size);
      return { data, mimeType: 'image/jpeg', ...size };
    }
    case 'svg':
      return rasterizeSvg(data);
    default:
      throw new LogoError('LOGO_INVALID_TYPE');
  }
}
