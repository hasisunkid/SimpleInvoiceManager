import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

/**
 * Roboto (Apache 2.0, bundled with pdfmake) covers German and Polish characters
 * (FR-I18N-05) and is embedded as a subset into every PDF (FR-PDF-03).
 */
export const FONT_DIR = path.dirname(require.resolve('pdfmake/fonts/Roboto/Roboto-Regular.ttf'));

export const ROBOTO = {
  normal: path.join(FONT_DIR, 'Roboto-Regular.ttf'),
  bold: path.join(FONT_DIR, 'Roboto-Medium.ttf'),
  italics: path.join(FONT_DIR, 'Roboto-Italic.ttf'),
  bolditalics: path.join(FONT_DIR, 'Roboto-MediumItalic.ttf'),
} as const;

export const FONT_FILES = [ROBOTO.normal, ROBOTO.bold];
