import { useEffect, useRef, useState } from 'react';
import type { Attachment, Payment } from '@campusbuddy/shared';
import { formatINR } from '@campusbuddy/shared';
import { ApiError, api } from '../lib/api';
import { PAYMENT_STATUS_LABEL } from '../lib/format';
import { useToast } from '../state/toast';
import { Alert, Button } from '../components/ui';

/**
 * Payment panel (spec §35).
 *
 * CampusBuddy does not move money and cannot see a bank transfer. It shows the
 * payee's QR code and UPI ID, opens the payer's UPI app with the details filled in,
 * records what each side says happened, and treats only the *payee's* confirmation
 * as evidence that money arrived. The wording here is deliberately explicit about
 * that, rather than implying the app verified anything.
 */
export function PaymentPanel({
  payment,
  isPayer,
  onChanged,
}: {
  payment: Payment;
  isPayer: boolean;
  onChanged: () => void;
}): JSX.Element {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [qrFailed, setQrFailed] = useState(false);
  const [transactionReference, setTransactionReference] = useState(payment.transactionReference ?? '');
  const [receipt, setReceipt] = useState<Attachment | null>(payment.receipt);
  const receiptInput = useRef<HTMLInputElement>(null);

  // A fresh link (after a reload) gets a fresh chance to load.
  useEffect(() => setQrFailed(false), [payment.payeeUpiQrUrl]);

  async function act(action: string, successMessage: string, details: Record<string, unknown> = {}): Promise<void> {
    setBusy(action);
    try {
      await api.post(`/payments/${payment.id}/action`, { action, ...details });
      toast.success(successMessage);
      onChanged();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : 'Could not update the payment.');
    } finally {
      setBusy(null);
    }
  }

  async function uploadReceipt(file: File): Promise<void> {
    setBusy('receipt');
    try {
      const { attachment } = await api.upload<{ attachment: Attachment }>(
        '/uploads?purpose=PROOF',
        file,
        file.name,
        'POST',
      );
      setReceipt(attachment);
      toast.success('Receipt attached.');
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : 'Could not upload the receipt.');
    } finally {
      setBusy(null);
    }
  }

  const can = (action: string): boolean => payment.availableActions.includes(action);
  const confirmed = payment.status === 'PAYMENT_CONFIRMED';
  const amount = formatINR(payment.amountPaise);
  const qrUrl = payment.payeeUpiQrUrl;
  const expired = payment.expiresAt ? new Date(payment.expiresAt).getTime() <= Date.now() : false;

  return (
    <div className="card stack">
      <div className="row row--between">
        <h2>Payment</h2>
        <span
          className={`badge badge--${confirmed ? 'success' : payment.status === 'PAYMENT_DISPUTED' ? 'danger' : 'warning'}`}
        >
          {PAYMENT_STATUS_LABEL[payment.status] ?? payment.status}
        </span>
      </div>

      {expired && !confirmed && (
        <Alert tone="warning" title="Payment window expired">
          Payment actions are closed. If money is unresolved, open a dispute from the request.
        </Alert>
      )}

      <div className="row row--between">
        <span className="muted">Amount</span>
        <span className="reward" style={{ fontSize: 22 }}>
          {amount}
        </span>
      </div>

      {confirmed ? (
        <Alert tone="success" title="Payment confirmed">
          The helper confirmed they received {amount}.
        </Alert>
      ) : isPayer ? (
        <>
          {qrUrl && (
            <div className="card card--flat stack stack--sm" style={{ background: 'var(--surface-2)' }}>
              <div className="small muted">Scan to pay</div>
              <div className="qr-frame">
                {qrFailed ? (
                  <div className="stack stack--sm center">
                    <p className="small muted">This QR code link has expired.</p>
                    <Button size="sm" variant="secondary" onClick={() => onChanged()}>
                      Reload
                    </Button>
                  </div>
                ) : (
                  <img
                    className="qr-image"
                    src={qrUrl}
                    alt="The helper's UPI QR code"
                    onError={() => setQrFailed(true)}
                  />
                )}
              </div>
              <div className="center">
                <div className="strong">Pay exactly {amount}</div>
                <div className="tiny muted">
                  A saved QR code usually doesn’t include the amount, so type it in your UPI app.
                </div>
              </div>
              {!qrFailed && (
                <a className="btn btn--secondary btn--sm btn--block" href={qrUrl} download="campusbuddy-upi-qr.png">
                  Save QR to scan from your gallery
                </a>
              )}
            </div>
          )}

          {payment.payeeUpiId && (
            <div className="card card--flat" style={{ background: 'var(--surface-2)' }}>
              <div className="small muted">{qrUrl ? 'Or pay to this UPI ID' : 'Pay to this UPI ID'}</div>
              <div className="strong" style={{ fontSize: 17, wordBreak: 'break-all', marginTop: 4 }}>
                {payment.payeeUpiId}
              </div>
              {payment.upiUri && (
                <a className="btn btn--block mt-3" href={payment.upiUri}>
                  Open UPI app
                </a>
              )}
              <button
                type="button"
                className="btn btn--ghost btn--block btn--sm mt-2"
                onClick={() => {
                  void navigator.clipboard?.writeText(payment.payeeUpiId ?? '');
                  toast.success('UPI ID copied.');
                }}
              >
                Copy UPI ID
              </button>
            </div>
          )}

          {!payment.payeeUpiId && !qrUrl && (
            <Alert tone="warning">
              The helper has not added a UPI ID or QR code yet. Ask them for one in the chat, or pay in
              cash and mark it below.
            </Alert>
          )}

          {/* The critical honesty statement (spec §122). */}
          <Alert tone="info" title="CampusBuddy cannot verify transfers">
            Scanning a code or opening your UPI app does not tell us whether the money went through.
            Mark it as sent once you have paid, and the helper confirms when it actually reaches them.
          </Alert>

          {(can('claim_sent') || payment.transactionReference || payment.receipt) && (
            <div className="card card--flat stack stack--sm" style={{ background: 'var(--surface-2)' }}>
              <div className="strong">Payment evidence (optional)</div>
              <div className="tiny muted">
                A reference or screenshot helps resolve problems, but it is not proof that the helper received money.
              </div>
              <input
                className="input"
                aria-label="UPI transaction reference"
                placeholder="UPI transaction/reference number"
                value={transactionReference}
                maxLength={100}
                disabled={!can('claim_sent')}
                onChange={(event) => setTransactionReference(event.target.value)}
              />
              <input
                ref={receiptInput}
                type="file"
                accept="image/*,application/pdf"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) void uploadReceipt(file);
                }}
              />
              {receipt ? (
                <a className="btn btn--secondary btn--sm btn--block" href={receipt.url} target="_blank" rel="noreferrer">
                  View attached receipt
                </a>
              ) : can('claim_sent') ? (
                <Button
                  size="sm"
                  variant="secondary"
                  block
                  loading={busy === 'receipt'}
                  onClick={() => receiptInput.current?.click()}
                >
                  Attach receipt screenshot
                </Button>
              ) : null}
            </div>
          )}

          <div className="stack stack--sm">
            {can('mark_initiated') && (
              <Button
                variant="secondary"
                block
                loading={busy === 'mark_initiated'}
                onClick={() => void act('mark_initiated', 'Marked as started.')}
              >
                I am paying now
              </Button>
            )}
            {can('claim_sent') && (
              <Button
                block
                loading={busy === 'claim_sent'}
                disabled={busy !== null}
                onClick={() =>
                  void act('claim_sent', 'The helper has been asked to confirm.', {
                    transactionReference: transactionReference.trim() || null,
                    receiptAttachmentId: receipt?.id ?? null,
                  })
                }
              >
                I have sent the money
              </Button>
            )}
          </div>
        </>
      ) : (
        <>
          {(payment.transactionReference || payment.receipt) && (
            <div className="card card--flat stack stack--sm" style={{ background: 'var(--surface-2)' }}>
              <div className="strong">Payer-provided evidence</div>
              {payment.transactionReference && (
                <div className="small">Reference: <strong>{payment.transactionReference}</strong></div>
              )}
              {payment.receipt && (
                <a className="btn btn--secondary btn--sm btn--block" href={payment.receipt.url} target="_blank" rel="noreferrer">
                  View receipt attachment
                </a>
              )}
              <div className="tiny muted">Check your own bank or UPI app before confirming.</div>
            </div>
          )}
          <Alert tone="info" title="You are being paid">
            {payment.status === 'PAYMENT_CLAIMED'
              ? 'The requester says they have sent the money. Check your bank or UPI app, and confirm only once it has actually arrived.'
              : 'Waiting for the requester to pay. You will be notified when they mark it as sent.'}
          </Alert>

          <div className="stack stack--sm">
            {can('confirm_received') && (
              <Button
                variant="success"
                size="lg"
                block
                loading={busy === 'confirm_received'}
                onClick={() => void act('confirm_received', 'Payment confirmed. Thanks!')}
              >
                Yes, I received {amount}
              </Button>
            )}
            {can('deny_received') && (
              <Button
                variant="secondary"
                block
                loading={busy === 'deny_received'}
                onClick={() => void act('deny_received', 'The requester has been told.')}
              >
                No, nothing has arrived
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
