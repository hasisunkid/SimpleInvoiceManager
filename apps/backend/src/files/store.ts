import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Knex } from 'knex';
import type { Db } from '../db.js';

export type FileKind = 'LOGO' | 'INVOICE_PDF';

export interface StoredFileRow {
  id: number;
  kind: FileKind;
  path: string;
  mime_type: string;
  size: number;
  sha256: string;
  width: number | null;
  height: number | null;
  created_by: number | null;
  created_at: Date;
}

const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'application/pdf': 'pdf',
};

/**
 * Files live under DATA_DIR (AR-15, included in HA backups); metadata and checksum in
 * `stored_file`. Paths are content-addressed (`<kind>/<sha256>.<ext>`), never user-controlled.
 */
export class FileStore {
  constructor(
    private readonly db: Db,
    private readonly dataDir: string,
  ) {}

  async save(
    kind: FileKind,
    data: Buffer,
    mimeType: string,
    meta: { createdBy: number | null; width?: number; height?: number },
    trx?: Knex.Transaction,
  ): Promise<StoredFileRow> {
    const ext = EXTENSIONS[mimeType];
    if (!ext) throw new Error(`Unsupported file type ${mimeType}`);
    const sha256 = createHash('sha256').update(data).digest('hex');
    const relative = path.posix.join(kind.toLowerCase(), `${sha256}.${ext}`);
    const absolute = path.join(this.dataDir, relative);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, data, { mode: 0o640 });

    const executor = trx ?? this.db;
    const [id] = await executor('stored_file').insert({
      kind,
      path: relative,
      mime_type: mimeType,
      size: data.length,
      sha256,
      width: meta.width ?? null,
      height: meta.height ?? null,
      created_by: meta.createdBy,
    });
    return (await this.find(id as number, kind, trx))!;
  }

  find(id: number, kind?: FileKind, trx?: Knex.Transaction): Promise<StoredFileRow | undefined> {
    const query = (trx ?? this.db)<StoredFileRow>('stored_file').where({ id });
    if (kind) query.andWhere({ kind });
    return query.first();
  }

  /** Reads the file and verifies its checksum, so silent corruption is noticed. */
  async read(row: StoredFileRow): Promise<Buffer> {
    const data = await readFile(path.join(this.dataDir, row.path));
    const sha256 = createHash('sha256').update(data).digest('hex');
    if (sha256 !== row.sha256) throw new Error(`Checksum mismatch for stored file ${row.id}`);
    return data;
  }
}
