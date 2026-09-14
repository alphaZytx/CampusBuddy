/**
 * Byte-level test fixtures for uploads.
 *
 * Built from explicit byte values rather than escape-laden strings, so exactly what
 * goes into each file is visible.
 */

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A valid 1×1 PNG: signature, IHDR, IDAT, IEND. */
export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const bytes = (...parts: Array<string | number[]>): Buffer =>
  Buffer.concat(
    parts.map((part) => (typeof part === 'string' ? Buffer.from(part, 'latin1') : Buffer.from(part))),
  );

export function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  // The stripper never checks CRCs, and these are the chunks it removes anyway.
  return Buffer.concat([length, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
}

/** Signature (8 bytes) plus the IHDR chunk (4 + 4 + 13 + 4 bytes). */
const PNG_IHDR_END = 8 + 25;

/** TINY_PNG with text and EXIF chunks inserted, and a payload appended after IEND. */
export function pngWithMetadata(): Buffer {
  return Buffer.concat([
    TINY_PNG.subarray(0, PNG_IHDR_END),
    pngChunk('tEXt', bytes('Location', [0], 'SECRET-PNG-TEXT')),
    pngChunk('eXIf', bytes('MM', [0, 42], 'SECRET-PNG-EXIF')),
    TINY_PNG.subarray(PNG_IHDR_END),
    bytes('APPENDED-PNG-TRAILER'),
  ]);
}

export function jpegSegment(marker: number, payload: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header[0] = 0xff;
  header[1] = marker;
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}

/**
 * A structurally valid JPEG carrying the kinds of metadata a phone camera writes:
 * an EXIF block with a GPS position, a comment, and data appended after the image.
 */
export function jpegWithMetadata(): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jpegSegment(0xe0, bytes('JFIF', [0, 1, 1, 0, 0, 1, 0, 1, 0, 0])),
    jpegSegment(0xe1, bytes('Exif', [0, 0], 'GPS-SECRET 25.5854N 84.8514E')),
    jpegSegment(0xfe, bytes('camera serial SECRET-COMMENT')),
    jpegSegment(0xdb, Buffer.alloc(65, 1)),
    jpegSegment(0xc0, Buffer.from([8, 0, 1, 0, 1, 1, 1, 0x11, 0])),
    jpegSegment(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])),
    Buffer.from([0x00, 0x11, 0xff, 0x00, 0x22, 0xff, 0xd9]),
    bytes('APPENDED-TRAILER'),
  ]);
}

const CRLF = String.fromCharCode(13, 10);

/** A single-file multipart/form-data body, as a browser's FormData would send it. */
export function multipartBody(
  file: Buffer,
  fileName: string,
  contentType: string,
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = `----campusbuddy${Math.random().toString(16).slice(2)}`;
  const head = Buffer.from(
    `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="file"; filename="${fileName}"${CRLF}` +
      `Content-Type: ${contentType}${CRLF}${CRLF}`,
  );
  const tail = Buffer.from(`${CRLF}--${boundary}--${CRLF}`);
  return {
    payload: Buffer.concat([head, file, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}
