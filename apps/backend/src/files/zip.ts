import { crc32 } from 'node:zlib';

/**
 * Minimal streaming ZIP writer (NFR-DATA-02 PDF export). Entries are *stored* (no compression –
 * PDFs and PNGs are compressed already), names are UTF-8 (flag bit 11). One entry is held in
 * memory at a time, so exporting years of invoices stays cheap on a Raspberry Pi.
 */
export interface ZipEntry {
  name: string;
  date: Date;
  read: () => Promise<Buffer>;
}

const MAX_ENTRIES = 0xffff; // no ZIP64 support needed for this use
const MAX_SIZE = 0xffffffff;

function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

export async function* zipStream(entries: readonly ZipEntry[]): AsyncGenerator<Buffer> {
  if (entries.length > MAX_ENTRIES) throw new Error('Too many files for a ZIP without ZIP64');
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const data = await entry.read();
    if (data.length > MAX_SIZE || offset > MAX_SIZE) throw new Error('ZIP too large');
    const name = Buffer.from(entry.name, 'utf8');
    const checksum = crc32(data);
    const { time, date } = dosDateTime(entry.date);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8); // method: stored
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    yield local;
    yield name;
    yield data;

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0); // central directory signature
    header.writeUInt16LE(20, 4); // version made by
    header.writeUInt16LE(20, 6); // version needed
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(time, 12);
    header.writeUInt16LE(date, 14);
    header.writeUInt32LE(checksum, 16);
    header.writeUInt32LE(data.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(offset, 42); // local header offset
    central.push(header, name);
    offset += local.length + name.length + data.length;
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  yield directory;
  yield end;
}
