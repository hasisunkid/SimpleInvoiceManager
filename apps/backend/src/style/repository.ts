import type { Db } from '../db.js';

export const LOGO_POSITIONS = ['LEFT', 'RIGHT'] as const;
export type LogoPosition = (typeof LOGO_POSITIONS)[number];

/** FR-STYLE-02: default accent colour = the blue of the reference invoices. */
export const DEFAULT_ACCENT_COLOR = '#3A7CA5';

export interface InvoiceStyle {
  logoFileId: number | null;
  logoPosition: LogoPosition;
  accentColor: string;
}

interface StyleRow {
  id: number;
  logo_file_id: number | null;
  logo_position: LogoPosition;
  accent_color: string;
}

export async function loadStyle(db: Db): Promise<InvoiceStyle> {
  const row = await db<StyleRow>('invoice_style').where({ id: 1 }).first();
  if (!row) throw new Error('invoice_style row missing – migration 0003 not applied?');
  return {
    logoFileId: row.logo_file_id,
    logoPosition: row.logo_position,
    accentColor: row.accent_color,
  };
}

export async function saveStyle(db: Db, style: InvoiceStyle, userId: number): Promise<void> {
  await db('invoice_style').where({ id: 1 }).update({
    logo_file_id: style.logoFileId,
    logo_position: style.logoPosition,
    accent_color: style.accentColor.toUpperCase(),
    updated_by: userId,
    updated_at: new Date(),
  });
}
