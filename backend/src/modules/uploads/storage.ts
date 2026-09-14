import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import type { AuthenticatedUser } from '../../core/context.js';
import { ApiError } from '../../core/errors.js';
import { enforceRateLimit, RATE_LIMITS } from '../../core/rate-limit.js';
import type { AttachmentRow } from '../../core/serializers.js';
import type { Database } from '../../db/client.js';
import { MalformedImageError, stripImageMetadata } from './metadata.js';

let s3: S3Client | null = null;
function objectStore(): S3Client | null {
  if (!env.S3_BUCKET) return null;
  if (!s3) {
    s3 = new S3Client({
      region: env.S3_REGION,
      ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
      forcePathStyle: env.S3_FORCE_PATH_STYLE === true,
      ...(env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
        ? { credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY } }
        : {}),
    });
  }
  return s3;
}

/**
 * File storage, shared by every endpoint that accepts a file (spec §70).
 *
 * Files are written outside any web root under a random key and are only ever
 * served through an authorising route. The type is taken from the file's own bytes,
 * never from the client's header or filename, and the stored extension comes from
 * that detected type — so an executable or an HTML page can never land on disk.
 */

export type AttachmentPurpose =
  | 'GENERAL'
  | 'AVATAR'
  | 'REQUEST'
  | 'MESSAGE'
  | 'LISTING'
  | 'RENTAL_ITEM'
  | 'PROOF'
  | 'DISPUTE'
  | 'REPORT'
  | 'UPI_QR'
  | 'LOST_FOUND';

const EXTENSION_BY_TYPE: Readonly<Record<string, string>> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/heic': '.heic',
  'application/pdf': '.pdf',
};

export const ANY_UPLOAD_TYPE: readonly string[] = Object.keys(EXTENSION_BY_TYPE);

/**
 * Profile photos and payment QR codes: formats every browser can display, and whose
 * metadata the server knows how to remove.
 */
export const PROFILE_IMAGE_TYPES: readonly string[] = ['image/jpeg', 'image/png'];

/** Magic-number sniffing: a client-declared content type is not trustworthy. */
export function detectMimeType(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (buffer.subarray(0, 3).toString('ascii') === 'GIF') return 'image/gif';
  if (buffer.subarray(0, 4).toString('ascii') === '%PDF') return 'application/pdf';
  if (
    buffer.subarray(4, 8).toString('ascii') === 'ftyp' &&
    buffer.subarray(8, 12).toString('ascii').startsWith('hei')
  ) {
    return 'image/heic';
  }
  return null;
}

/** Characters that are unsafe in a file name, besides the invisible control range. */
const RESERVED_FILE_NAME_CHARACTERS = '<>:"/\\|?*';

/** Strips directories, control characters and reserved characters from a file name. */
export function sanitiseFileName(name: string): string {
  const safe = Array.from(path.basename(name), (character) =>
    character.charCodeAt(0) < 32 || RESERVED_FILE_NAME_CHARACTERS.includes(character) ? '_' : character,
  )
    .join('')
    .trim();
  return safe.slice(0, 120) || 'upload';
}

const tooLarge = (): ApiError =>
  ApiError.payloadTooLarge(`Files must be under ${Math.round(env.MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`);

async function assertClean(buffer: Buffer, mimeType: string): Promise<void> {
  if (!env.MALWARE_SCAN_URL) return;
  let response: Response;
  try {
    response = await fetch(env.MALWARE_SCAN_URL, {
      method: 'POST',
      headers: {
        'content-type': mimeType,
        ...(env.MALWARE_SCAN_TOKEN ? { authorization: `Bearer ${env.MALWARE_SCAN_TOKEN}` } : {}),
      },
      body: new Uint8Array(buffer),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ApiError(503, 'SCAN_UNAVAILABLE', 'File scanning is temporarily unavailable. Try again shortly.');
  }
  if (response.status === 422) throw ApiError.badRequest('That file was rejected by the safety scanner.');
  if (!response.ok) throw new ApiError(503, 'SCAN_UNAVAILABLE', 'File scanning is temporarily unavailable. Try again shortly.');
}

export interface ReceiveUploadOptions {
  purpose: AttachmentPurpose;
  allowedTypes: readonly string[];
  /** Shown when the file is not one of `allowedTypes`. */
  rejectMessage: string;
  /** Remove EXIF, text chunks and trailing data. Only meaningful for JPEG and PNG. */
  stripMetadata?: boolean;
  /** Readable by anyone on campus with a bearer token, not just the owner. */
  isPublic?: boolean;
}

/** Reads one file from a multipart request, validates it, stores it, and records it. */
export async function receiveUpload(
  request: FastifyRequest,
  user: AuthenticatedUser,
  options: ReceiveUploadOptions,
): Promise<AttachmentRow> {
  if (!request.isMultipart()) throw ApiError.badRequest('Attach a file to upload.');

  await enforceRateLimit(
    request.db,
    RATE_LIMITS.upload,
    user.id,
    'You have uploaded a lot of files recently. Please wait a while.',
  );

  const file = await request.file();
  if (!file) throw ApiError.badRequest('Attach a file to upload.');

  let buffer: Buffer;
  try {
    buffer = await file.toBuffer();
  } catch (error) {
    if ((error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') throw tooLarge();
    throw error;
  }
  if (file.file.truncated) throw tooLarge();
  if (buffer.length === 0) throw ApiError.badRequest('That file is empty.');

  // Trust the bytes, not the header.
  const detected = detectMimeType(buffer);
  if (!detected || !options.allowedTypes.includes(detected)) {
    throw ApiError.badRequest(options.rejectMessage);
  }

  const quota = await request.db.query<{ user_bytes: string; campus_bytes: string }>(
    `SELECT COALESCE(sum(size_bytes) FILTER (WHERE owner_id = $1), 0)::text AS user_bytes,
            COALESCE(sum(size_bytes) FILTER (WHERE campus_id = $2), 0)::text AS campus_bytes
       FROM attachments`,
    [user.id, user.campusId],
  );
  if (Number(quota.rows[0]?.user_bytes ?? 0) + buffer.length > env.USER_UPLOAD_QUOTA_BYTES) {
    throw ApiError.payloadTooLarge('Your CampusBuddy storage quota has been reached. Remove unused media or contact support.');
  }
  if (Number(quota.rows[0]?.campus_bytes ?? 0) + buffer.length > env.CAMPUS_UPLOAD_QUOTA_BYTES) {
    throw new ApiError(503, 'CAMPUS_STORAGE_FULL', 'Campus media storage is temporarily full.');
  }

  await assertClean(buffer, detected);

  if (options.stripMetadata) {
    try {
      buffer = stripImageMetadata(buffer, detected);
    } catch (error) {
      if (error instanceof MalformedImageError) {
        throw ApiError.badRequest('That image appears to be damaged. Try a different one.');
      }
      throw error;
    }
  }

  const attachmentId = randomUUID();
  const storageKey = `${attachmentId}${EXTENSION_BY_TYPE[detected]}`;
  const store = objectStore();
  const destination = path.join(env.uploadDir, storageKey);

  if (store) {
    await store.send(new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: storageKey,
      Body: buffer,
      ContentType: detected,
      ServerSideEncryption: 'AES256',
    }));
  } else {
    await writeFile(destination, buffer);
  }
  try {
    const { rows } = await request.db.query<AttachmentRow>(
      `INSERT INTO attachments (id, campus_id, owner_id, file_name, storage_key,
                                mime_type, size_bytes, purpose, is_public)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, file_name, mime_type, size_bytes`,
      [
        attachmentId,
        user.campusId,
        user.id,
        sanitiseFileName(file.filename ?? 'upload'),
        storageKey,
        detected,
        buffer.length,
        options.purpose,
        options.isPublic ?? false,
      ],
    );
    return rows[0];
  } catch (error) {
    // Never leave an orphan file behind when the row could not be written.
    if (store) {
      await store.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: storageKey })).catch(() => undefined);
    } else {
      await unlink(destination).catch(() => undefined);
    }
    throw error;
  }
}

/** Deletes an attachment's record and its file. A missing file is logged, not fatal. */
export async function deleteAttachment(db: Database, attachmentId: string): Promise<void> {
  const { rows } = await db.query<{ storage_key: string }>(
    'DELETE FROM attachments WHERE id = $1 RETURNING storage_key',
    [attachmentId],
  );
  const storageKey = rows[0]?.storage_key;
  if (!storageKey) return;

  const store = objectStore();
  if (store) {
    await store.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: storageKey })).catch((error: Error) =>
      logger.warn('Could not delete an attachment object', { attachmentId, message: error.message }),
    );
  } else {
    await unlink(path.join(env.uploadDir, storageKey)).catch((error: Error) =>
      logger.warn('Could not delete an attachment file', { attachmentId, message: error.message }),
    );
  }
}

export interface ServableAttachment {
  storage_key: string;
  mime_type: string;
  file_name: string;
}

/** Streams a stored file with headers that stop it being executed or sniffed. */
export async function sendAttachment(
  reply: FastifyReply,
  attachment: ServableAttachment,
  options: { attachmentId: string; cacheSeconds: number },
): Promise<FastifyReply> {
  const filePath = path.join(env.uploadDir, attachment.storage_key);
  const store = objectStore();
  if (store) {
    try {
      const object = await store.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: attachment.storage_key }));
      return reply
        .header('Content-Type', attachment.mime_type)
        .header('Content-Disposition', `inline; filename="${encodeURIComponent(attachment.file_name)}"`)
        .header('Content-Security-Policy', "default-src 'none'; sandbox")
        .header('X-Content-Type-Options', 'nosniff')
        .header('Cache-Control', `private, max-age=${options.cacheSeconds}`)
        .send(object.Body);
    } catch (error) {
      logger.error('Attachment row exists but its object is missing', {
        attachmentId: options.attachmentId,
        message: (error as Error).message,
      });
      throw ApiError.notFound('That file is no longer available.');
    }
  }
  try {
    await stat(filePath);
  } catch {
    logger.error('Attachment row exists but its file is missing', {
      attachmentId: options.attachmentId,
    });
    throw ApiError.notFound('That file is no longer available.');
  }

  return reply
    .header('Content-Type', attachment.mime_type)
    .header('Content-Disposition', `inline; filename="${encodeURIComponent(attachment.file_name)}"`)
    // Even if something slipped past the type check, it cannot execute or phone home.
    .header('Content-Security-Policy', "default-src 'none'; sandbox")
    .header('X-Content-Type-Options', 'nosniff')
    // An attachment id never changes content, so it can be cached until the link expires.
    .header('Cache-Control', `private, max-age=${Math.round(options.cacheSeconds)}, immutable`)
    .send(createReadStream(filePath));
}
