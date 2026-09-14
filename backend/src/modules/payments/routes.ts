import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { PaymentStatus } from '@campusbuddy/shared';
import { assertPaymentTransition, formatINR, paymentActionSchema } from '@campusbuddy/shared';
import { requireVerified } from '../../core/context.js';
import { ApiError } from '../../core/errors.js';
import { parseOrThrow } from '../../core/validate.js';
import { withUserTx } from '../../core/outbox.js';
import { toPayment, type PaymentRow } from '../../core/serializers.js';
import { notify } from '../notifications/service.js';
import { publish, requestChannel } from '../../realtime/hub.js';
import { applyTransition, lockRequest } from '../requests/service.js';

/**
 * Payments (spec §35, §36).
 *
 * CampusBuddy does not move money and never claims to have verified a bank transfer.
 * It builds a UPI deep link, records what each side says happened, and treats only
 * the *payee's* confirmation as evidence that the money arrived. That asymmetry is
 * the whole design: a payer's claim alone can never mark a request paid.
 */

const idParams = z.object({ id: z.string().uuid('Unknown payment') });

/** Which action each participant may take from a given payment state. */
const ACTION_TARGETS: Record<string, { to: PaymentStatus; actor: 'REQUESTER' | 'HELPER' }> = {
  mark_initiated: { to: 'PAYMENT_INITIATED', actor: 'REQUESTER' },
  claim_sent: { to: 'PAYMENT_CLAIMED', actor: 'REQUESTER' },
  confirm_received: { to: 'PAYMENT_CONFIRMED', actor: 'HELPER' },
  deny_received: { to: 'PAYMENT_DISPUTED', actor: 'HELPER' },
  dispute: { to: 'PAYMENT_DISPUTED', actor: 'REQUESTER' },
};

const PAYMENT_SELECT = `
  SELECT p.id, p.campus_id, p.request_id, p.rental_id, p.payer_id, p.payee_id, p.amount_paise,
         p.method, p.status, p.reference_note, p.transaction_reference, p.expires_at,
         p.claimed_at, p.confirmed_at, p.created_at,
         CASE WHEN receipt.id IS NOT NULL THEN to_jsonb(receipt) END AS receipt_attachment,
         pu.upi_id AS payee_upi_id, pu.upi_qr_attachment_id AS payee_upi_qr_attachment_id, pu.full_name AS payee_name
    FROM payments p JOIN users pu ON pu.id = p.payee_id
    LEFT JOIN attachments receipt ON receipt.id = p.receipt_attachment_id
`;

/** Actions the viewer may take right now, derived from the payment state machine. */
function actionsFor(row: PaymentRow, viewerId: string): string[] {
  const isPayer = row.payer_id === viewerId;
  const expired = row.expires_at ? new Date(row.expires_at).getTime() <= Date.now() : false;
  const actions: string[] = [];
  for (const [action, target] of Object.entries(ACTION_TARGETS)) {
    const viewerIsActor = target.actor === 'REQUESTER' ? isPayer : !isPayer;
    if (!viewerIsActor) continue;
    if (expired && ['mark_initiated', 'claim_sent', 'confirm_received'].includes(action)) continue;
    try {
      assertPaymentTransition(row.status, target.to, target.actor);
      actions.push(action);
    } catch {
      // Not permitted from this state — simply not offered.
    }
  }
  return actions;
}

export async function paymentRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', async (request) => {
    const user = requireVerified(request);
    return withUserTx(request.db, user, async (tx) => {
      const { rows } = await tx.query<PaymentRow>(
        `${PAYMENT_SELECT} WHERE p.payer_id = $1 OR p.payee_id = $1 ORDER BY p.created_at DESC LIMIT 100`,
        [user.id],
      );
      return { payments: rows.map((row) => toPayment(row, user.id, actionsFor(row, user.id))) };
    });
  });

  app.get('/:id', async (request) => {
    const user = requireVerified(request);
    const { id } = parseOrThrow(idParams, request.params);

    return withUserTx(request.db, user, async (tx) => {
      const { rows } = await tx.query<PaymentRow>(`${PAYMENT_SELECT} WHERE p.id = $1`, [id]);
      const row = rows[0];
      if (!row) throw ApiError.notFound('That payment is not available.');

      const events = await tx.query(
        `SELECT id, from_status, to_status, action, actor_role, note, created_at
           FROM transaction_events WHERE payment_id = $1 ORDER BY created_at ASC`,
        [id],
      );
      return {
        payment: toPayment(row, user.id, actionsFor(row, user.id)),
        events: events.rows,
      };
    });
  });

  /**
   * Advance a payment. The action determines the target state, the state machine
   * decides whether it is legal, and the caller's relationship to the payment
   * decides whether they are allowed to be the one doing it.
   */
  app.post('/:id/action', async (request) => {
    const user = requireVerified(request);
    const { id } = parseOrThrow(idParams, request.params);
    const body = parseOrThrow(paymentActionSchema, request.body);

    return withUserTx(request.db, user, async (tx, outbox) => {
      const { rows } = await tx.query<PaymentRow & { campus_id: string }>(
        `${PAYMENT_SELECT} WHERE p.id = $1 FOR UPDATE OF p`,
        [id],
      );
      const payment = rows[0];
      if (!payment) throw ApiError.notFound('That payment is not available.');

      const isPayer = payment.payer_id === user.id;
      const isPayee = payment.payee_id === user.id;
      if (!isPayer && !isPayee) throw ApiError.forbidden('You are not part of this payment.');

      const target = ACTION_TARGETS[body.action];
      if (!target) throw ApiError.badRequest('Unknown payment action.');

      const expectedActor = target.actor === 'REQUESTER' ? isPayer : isPayee;
      if (!expectedActor) {
        throw ApiError.forbidden(
          target.actor === 'HELPER'
            ? 'Only the student receiving the money can confirm it arrived.'
            : 'Only the student paying can do that.',
        );
      }

      // Throws with a clear message when the move is not legal from here.
      assertPaymentTransition(payment.status, target.to, target.actor);

      const now = new Date();
      await tx.query(
        `UPDATE payments
            SET status = $2,
                claimed_at   = CASE WHEN $2 = 'PAYMENT_CLAIMED'   THEN $3 ELSE claimed_at   END,
                confirmed_at = CASE WHEN $2 = 'PAYMENT_CONFIRMED' THEN $3 ELSE confirmed_at END,
                reference_note = COALESCE($4, reference_note),
                transaction_reference = COALESCE($5, transaction_reference),
                receipt_attachment_id = COALESCE($6, receipt_attachment_id)
          WHERE id = $1`,
        [
          id,
          target.to,
          now,
          body.note ?? null,
          body.transactionReference ?? null,
          body.receiptAttachmentId ?? null,
        ],
      );
      await tx.query(
        `INSERT INTO transaction_events (payment_id, from_status, to_status, action, actor_id, actor_role, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, payment.status, target.to, body.action, user.id, target.actor, body.note ?? null],
      );

      // Only a confirmed receipt moves the request itself to PAID.
      if (target.to === 'PAYMENT_CONFIRMED' && payment.request_id) {
        const locked = await lockRequest(tx, payment.request_id);
        if (locked.status === 'PAYMENT_PENDING') {
          await applyTransition(tx, locked, 'PAID', 'payment_confirmed', 'SYSTEM', null, {
            note: 'Helper confirmed the payment was received',
          });
        }
      }

      const counterpartyId = isPayer ? payment.payee_id : payment.payer_id;
      const amount = formatINR(Number(payment.amount_paise));
      const messages: Record<string, { title: string; body: string }> = {
        mark_initiated: { title: 'Payment started', body: `${user.fullName} is paying you ${amount}.` },
        claim_sent: {
          title: 'Payment sent',
          body: `${user.fullName} says they sent ${amount}. Confirm once it reaches your account.`,
        },
        confirm_received: { title: 'Payment confirmed', body: `${user.fullName} confirmed receiving ${amount}.` },
        deny_received: {
          title: 'Payment not received',
          body: `${user.fullName} says the ${amount} has not arrived.`,
        },
        dispute: { title: 'Payment disputed', body: `${user.fullName} raised a payment problem.` },
      };
      const message = messages[body.action];
      if (message) {
        await notify(
          tx,
          {
            userId: counterpartyId,
            campusId: payment.campus_id,
            type: 'PAYMENT_UPDATED',
            title: message.title,
            body: message.body,
            data: { paymentId: id, requestId: payment.request_id },
            preference: 'payments',
            important: true,
          },
          outbox,
        );
      }

      if (payment.request_id) {
        const requestId = payment.request_id;
        outbox.add(() =>
          publish(requestChannel(requestId), 'PAYMENT_UPDATED', {
            requestId,
            paymentId: id,
            status: target.to,
          }),
        );
      }

      const updated = await tx.query<PaymentRow>(`${PAYMENT_SELECT} WHERE p.id = $1`, [id]);
      return {
        payment: toPayment(updated.rows[0], user.id, actionsFor(updated.rows[0], user.id)),
      };
    });
  });
}
