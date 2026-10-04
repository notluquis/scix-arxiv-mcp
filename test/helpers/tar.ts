import { gzipSync } from 'node:zlib';

/** One ustar entry. `type` is the typeflag ('0' file, 'L' GNU long name, 'x' pax header, ...). */
export function createTarEntry(name: string, content: string | Buffer, type = '0'): Buffer {
  const data = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
  const header = Buffer.alloc(512, 0);

  header.write(name, 0, Math.min(100, Buffer.byteLength(name)), 'utf8');
  header.write('0000777\0', 100, 'utf8');
  header.write('0000000\0', 108, 'utf8');
  header.write('0000000\0', 116, 'utf8');
  header.write(data.length.toString(8).padStart(11, '0') + '\0', 124, 'utf8');
  header.write('00000000000\0', 136, 'utf8');
  header.write('        ', 148, 'utf8');
  header[156] = type.charCodeAt(0);
  header.write('ustar\0', 257, 'utf8');
  header.write('00', 263, 'utf8');

  const padding = Buffer.alloc((512 - (data.length % 512)) % 512, 0);
  return Buffer.concat([header, data, padding]);
}

/** A file whose name is longer than 100 bytes: GNU `././@LongLink` ('L') entry, then the file. */
export function createGnuLongNameEntry(longName: string, content: string): Buffer {
  return Buffer.concat([
    createTarEntry('././@LongLink', `${longName}\0`, 'L'),
    createTarEntry(longName.slice(0, 99), content),
  ]);
}

/** A file named through a pax extended header (`path=`), as modern tars write long paths. */
export function createPaxEntry(path: string, content: string): Buffer {
  const body = ` path=${path}\n`;
  let len = body.length + String(body.length).length;
  if (String(len).length !== String(body.length).length) len += 1; // the length field counts itself
  return Buffer.concat([
    createTarEntry('PaxHeader/x', `${len}${body}`, 'x'),
    createTarEntry('short-name', content),
  ]);
}

export function makeTarArchive(files: Record<string, string>): Buffer {
  const entries = Object.entries(files).map(([name, content]) => createTarEntry(name, content));
  return Buffer.concat([...entries, Buffer.alloc(1024, 0)]);
}

export function tarOf(...entries: Buffer[]): Buffer {
  return Buffer.concat([...entries, Buffer.alloc(1024, 0)]);
}

export const tgz = (files: Record<string, string>): Buffer => gzipSync(makeTarArchive(files));
