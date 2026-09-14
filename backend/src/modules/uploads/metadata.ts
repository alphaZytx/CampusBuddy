/**
 * Image metadata removal.
 *
 * A photo straight off a phone carries EXIF data — often including the GPS
 * position where it was taken, which for a student is usually their hostel room.
 * CampusBuddy promises not to expose exact locations (spec §49), so profile photos
 * and payment QR codes are cleaned before they are stored.
 *
 * The student app already re-encodes images through a canvas, which drops all
 * metadata. This is the server-side guarantee for anything that arrives another
 * way. It works on the file structure alone — no image decoding, no native
 * library — and refuses a file whose structure it cannot follow rather than
 * storing it unexamined.
 */

export class MalformedImageError extends Error {
  constructor() {
    super('The image structure could not be read');
    this.name = 'MalformedImageError';
  }
}

// --- JPEG -------------------------------------------------------------------

/**
 * APPn segments needed to display the image correctly: APP0 (JFIF), APP2 (ICC colour
 * profile) and APP14 (Adobe colour transform). Every other APPn — EXIF and XMP in
 * APP1, IPTC in APP13, assorted vendor data — and comments are dropped.
 */
const JPEG_KEPT_APP_SEGMENTS = new Set([0xe0, 0xe2, 0xee]);

const isRestartMarker = (code: number): boolean => code >= 0xd0 && code <= 0xd7;

export function stripJpegMetadata(input: Buffer): Buffer {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) throw new MalformedImageError();

  const kept: Buffer[] = [input.subarray(0, 2)];
  let offset = 2;

  while (offset < input.length) {
    if (input[offset] !== 0xff) throw new MalformedImageError();

    // A marker may be preceded by any number of 0xFF fill bytes.
    let codeAt = offset + 1;
    while (codeAt < input.length && input[codeAt] === 0xff) codeAt += 1;
    if (codeAt >= input.length) throw new MalformedImageError();

    const marker = input[codeAt];
    const markerStart = codeAt - 1;
    const afterMarker = codeAt + 1;

    // End of image: anything appended after it is discarded.
    if (marker === 0xd9) {
      kept.push(input.subarray(markerStart, afterMarker));
      return Buffer.concat(kept);
    }

    // Markers that carry no length field.
    if (marker === 0x01 || isRestartMarker(marker)) {
      kept.push(input.subarray(markerStart, afterMarker));
      offset = afterMarker;
      continue;
    }

    if (afterMarker + 2 > input.length) throw new MalformedImageError();
    const length = input.readUInt16BE(afterMarker);
    const segmentEnd = afterMarker + length;
    if (length < 2 || segmentEnd > input.length) throw new MalformedImageError();

    if (marker === 0xda) {
      // Start of scan: compressed data follows, with no length. It runs until the
      // next real marker — 0xFF followed by anything other than a stuffed 0x00, a
      // fill byte, or a restart marker.
      let nextMarkerAt = -1;
      for (let scan = segmentEnd; scan + 1 < input.length; scan += 1) {
        if (input[scan] !== 0xff) continue;
        const next = input[scan + 1];
        if (next === 0x00 || next === 0xff || isRestartMarker(next)) continue;
        nextMarkerAt = scan;
        break;
      }
      if (nextMarkerAt === -1) throw new MalformedImageError(); // no end-of-image marker
      kept.push(input.subarray(markerStart, nextMarkerAt));
      offset = nextMarkerAt;
      continue;
    }

    const isAppSegment = marker >= 0xe0 && marker <= 0xef;
    const isComment = marker === 0xfe;
    const drop = isComment || (isAppSegment && !JPEG_KEPT_APP_SEGMENTS.has(marker));
    if (!drop) kept.push(input.subarray(markerStart, segmentEnd));
    offset = segmentEnd;
  }

  // Ran out of data without reaching the end-of-image marker.
  throw new MalformedImageError();
}

// --- PNG --------------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Ancillary chunks that hold metadata rather than pixels or colour information. */
const PNG_DROPPED_CHUNKS = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);

export function stripPngMetadata(input: Buffer): Buffer {
  if (input.length < PNG_SIGNATURE.length || !input.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new MalformedImageError();
  }

  const kept: Buffer[] = [input.subarray(0, 8)];
  let offset = 8;

  // Each chunk: 4-byte length, 4-byte type, data, 4-byte CRC.
  while (offset + 12 <= input.length) {
    const length = input.readUInt32BE(offset);
    const type = input.toString('latin1', offset + 4, offset + 8);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > input.length) throw new MalformedImageError();

    if (!PNG_DROPPED_CHUNKS.has(type)) kept.push(input.subarray(offset, chunkEnd));
    offset = chunkEnd;

    // Anything appended after the final chunk is discarded.
    if (type === 'IEND') return Buffer.concat(kept);
  }

  throw new MalformedImageError();
}

/**
 * Strips metadata from a JPEG or PNG. Other formats are returned unchanged, so
 * callers that need a guarantee must restrict uploads to these two types — which
 * the profile photo and payment QR endpoints do.
 */
export function stripImageMetadata(buffer: Buffer, mimeType: string): Buffer {
  if (mimeType === 'image/jpeg') return stripJpegMetadata(buffer);
  if (mimeType === 'image/png') return stripPngMetadata(buffer);
  return buffer;
}
