import { mkdir } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { requireAuth } from '../../core/context.js';
import { ApiError } from '../../core/errors.js';
import { toAttachment } from '../../core/serializers.js';
import { verifyAttachmentSignature } from '../../core/signed-urls.js';
import { parseOrThrow } from '../../core/validate.js';
import type { Database } from '../../db/client.js';
import { ANY_UPLOAD_TYPE, receiveUpload, sendAttachment, type AttachmentPurpose } from './storage.js';

/**
 * File routes (spec §70).
 *
 * Uploading: `POST /api/uploads` stores a general-purpose file. Profile photos and
 * payment QR codes have their own endpoints under `/api/users/me`, because they are
 * validated and cleaned more strictly and replace the previous file.
 *
 * Downloading: `GET /api/uploads/:id` accepts either
 *   - a signed link (`?expires=…&signature=…`) — what `<img>` tags use, since a
 *     browser cannot attach a bearer token to an image request. The signature is
 *     minted only for viewers who are entitled to the file, so it is the
 *     authorisation; or
 *   - a bearer token, checked against ownership and the file's parent record.
 */

const GENERAL_PURPOSES = [
  'GENERAL',
  'REQUEST',
  'MESSAGE',
  'LISTING',
  'RENTAL_ITEM',
  'PROOF',
  'DISPUTE',
  'REPORT',
  'LOST_FOUND',
] as const satisfies readonly AttachmentPurpose[];

const idParams = z.object({ id: z.string().uuid('Unknown file') });
const uploadQuery = z.object({ purpose: z.string().max(40).default('GENERAL') });
const linkQuery = z.object({
  expires: z.coerce.number().int().optional(),
  signature: z.string().max(200).optional(),
});

export async function uploadRoutes(app: FastifyInstance): Promise<void> {
  await mkdir(env.uploadDir, { recursive: true });

  app.post('/', async (request, reply) => {
    const user = requireAuth(request);
    const { purpose } = parseOrThrow(uploadQuery, request.query ?? {});

    if (purpose === 'AVATAR') {
      throw ApiError.badRequest('Profile photos are uploaded with PUT /api/users/me/avatar.');
    }
    if (purpose === 'UPI_QR') {
      throw ApiError.badRequest('Payment QR codes are uploaded with PUT /api/users/me/payment-qr.');
    }
    if (!(GENERAL_PURPOSES as readonly string[]).includes(purpose)) {
      throw ApiError.validation('Unknown upload purpose.');
    }

    const attachment = await receiveUpload(request, user, {
      purpose: purpose as AttachmentPurpose,
      allowedTypes: ANY_UPLOAD_TYPE,
      rejectMessage: 'Only JPEG, PNG, WebP, GIF and HEIC images, or PDF files, can be uploaded.',
    });
    return reply.code(201).send({ attachment: toAttachment(attachment) });
  });

  app.get('/:id', async (request, reply) => {
    const { id } = parseOrThrow(idParams, request.params);
    const link = parseOrThrow(linkQuery, request.query ?? {});

    const { rows } = await request.db.query<{
      storage_key: string;
      mime_type: string;
      file_name: string;
      owner_id: string;
      campus_id: string;
      is_public: boolean;
    }>(
      `SELECT storage_key, mime_type, file_name, owner_id, campus_id, is_public
         FROM attachments WHERE id = $1`,
      [id],
    );
    const attachment = rows[0];

    // --- Signed link -------------------------------------------------------
    if (link.signature !== undefined || link.expires !== undefined) {
      // The signature is checked before existence, so an invalid link reveals nothing.
      if (
        link.signature === undefined ||
        link.expires === undefined ||
        !verifyAttachmentSignature(id, link.expires, link.signature)
      ) {
        throw new ApiError(403, 'LINK_EXPIRED', 'This link has expired. Refresh the page to get a new one.');
      }
      if (!attachment) throw ApiError.notFound('That file is no longer available.');
      const secondsLeft = Math.max(60, link.expires - Math.floor(Date.now() / 1000));
      return sendAttachment(reply, attachment, { attachmentId: id, cacheSeconds: secondsLeft });
    }

    // --- Bearer token ------------------------------------------------------
    const user = requireAuth(request);
    // The same 404 for "missing" and "not on your campus", so the route leaks nothing.
    if (!attachment || attachment.campus_id !== user.campusId) {
      throw ApiError.notFound('That file is not available.');
    }
    if (!attachment.is_public && attachment.owner_id !== user.id) {
      const allowed = await canAccessAttachment(request.db, id, user.id);
      if (!allowed) throw ApiError.forbidden('You do not have access to that file.');
    }
    return sendAttachment(reply, attachment, { attachmentId: id, cacheSeconds: 3600 });
  });
}

/** True when the viewer is a party to whatever the file is attached to. */
async function canAccessAttachment(
  db: Database,
  attachmentId: string,
  viewerId: string,
): Promise<boolean> {
  const { rows } = await db.query<{ allowed: boolean }>(
    `SELECT EXISTS (
       -- Attached to a request the viewer is part of
       SELECT 1 FROM request_attachments ra
         JOIN requests r ON r.id = ra.request_id
        WHERE ra.attachment_id = $1
          AND (r.requester_id = $2 OR r.selected_helper_id = $2)
       UNION ALL
       -- Proof of completion on such a request
       SELECT 1 FROM requests r
        WHERE r.completion_proof_id = $1
          AND (r.requester_id = $2 OR r.selected_helper_id = $2)
       UNION ALL
       -- Sent in a conversation the viewer belongs to
       SELECT 1 FROM messages m
         JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id
        WHERE m.attachment_id = $1 AND cp.user_id = $2
       UNION ALL
       -- Photos on a marketplace listing or rental item, which are campus-visible
       SELECT 1 FROM listing_images WHERE attachment_id = $1
       UNION ALL
       SELECT 1 FROM rental_item_images WHERE attachment_id = $1
       UNION ALL
       SELECT 1 FROM lost_found_images WHERE attachment_id = $1
       UNION ALL
       -- Evidence on a dispute the viewer is party to
       SELECT 1 FROM dispute_evidence e
         JOIN disputes d ON d.id = e.dispute_id
        WHERE e.attachment_id = $1
          AND (d.opened_by = $2 OR d.against_id = $2)
       UNION ALL
       SELECT 1 FROM report_evidence e
         JOIN reports r ON r.id = e.report_id
        WHERE e.attachment_id = $1 AND (r.reporter_id = $2 OR EXISTS (
          SELECT 1 FROM users staff WHERE staff.id = $2 AND staff.role IN ('MODERATOR','CAMPUS_ADMIN','PLATFORM_ADMIN')
        ))
       UNION ALL
       SELECT 1 FROM payments p
        WHERE p.receipt_attachment_id = $1 AND (p.payer_id = $2 OR p.payee_id = $2)
     ) AS allowed`,
    [attachmentId, viewerId],
  );
  return rows[0]?.allowed ?? false;
}
