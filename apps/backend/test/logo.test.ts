import { describe, expect, it } from 'vitest';
import { LogoError, jpegSize, pngSize, sniff } from '../src/style/logo.js';

/** Minimal JPEG header: SOI, APP0 (JFIF), SOF0 with height 120 and width 340. */
const jpegHeader = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x78, 0x01, 0x54, 0x03, 0x01, 0x22,
  0x00,
]);

describe('logo sniffing', () => {
  it('detects types from content', () => {
    expect(sniff(jpegHeader)).toBe('jpeg');
    expect(sniff(Buffer.from('<?xml version="1.0"?>\n<svg xmlns="x"/>'))).toBe('svg');
    expect(sniff(Buffer.from('﻿<!-- logo --><svg width="1"/>'))).toBe('svg');
    expect(sniff(Buffer.from('<html><svg/></html>'))).toBeNull();
    expect(sniff(Buffer.from('GIF89a'))).toBeNull();
  });

  it('reads JPEG dimensions from the SOF segment', () => {
    expect(jpegSize(jpegHeader)).toEqual({ width: 340, height: 120 });
  });

  it('rejects truncated or malformed headers', () => {
    expect(() => jpegSize(jpegHeader.subarray(0, 12))).toThrow(LogoError);
    const broken = Buffer.from(jpegHeader);
    broken[20] = 0x00; // not a marker
    expect(() => jpegSize(broken)).toThrow(LogoError);
    expect(() => pngSize(Buffer.alloc(24))).toThrow(LogoError);
  });
});
