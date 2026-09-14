import { useState } from 'react';
import { ApiError, api } from '../lib/api';
import { useToast } from '../state/toast';
import { Button, Field, Sheet, StarPicker, Textarea } from '../components/ui';

/**
 * Two-way rating (spec §38).
 *
 * The dimensions differ by side: a helper is rated on punctuality and quality, a
 * requester on clear instructions and paying reliably.
 */
export function RatingSheet({
  open,
  onClose,
  requestId,
  ratingHelper,
  counterpartyName,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  requestId: string;
  /** True when the viewer is the requester rating their helper. */
  ratingHelper: boolean;
  counterpartyName: string;
  onDone: () => void;
}): JSX.Element {
  const toast = useToast();
  const [stars, setStars] = useState(5);
  const [detail, setDetail] = useState<Record<string, number>>({});
  const [review, setReview] = useState('');
  const [busy, setBusy] = useState(false);

  const dimensions = ratingHelper
    ? [
        { key: 'punctuality', label: 'On time' },
        { key: 'reliability', label: 'Reliable' },
        { key: 'communication', label: 'Communication' },
        { key: 'quality', label: 'Quality' },
      ]
    : [
        { key: 'clearInstructions', label: 'Clear instructions' },
        { key: 'communication', label: 'Communication' },
        { key: 'paymentReliability', label: 'Paid reliably' },
        { key: 'respectfulness', label: 'Respectful' },
      ];

  async function submit(): Promise<void> {
    setBusy(true);
    try {
      await api.post(`/requests/${requestId}/ratings`, {
        stars,
        review: review.trim() || null,
        ...detail,
      });
      toast.success('Thanks for the rating.');
      onDone();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : 'Could not submit your rating.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={`Rate ${counterpartyName}`}>
      <StarPicker label="Overall" value={stars} onChange={setStars} />

      <div className="divider" />

      {dimensions.map((dimension) => (
        <StarPicker
          key={dimension.key}
          label={dimension.label}
          value={detail[dimension.key] ?? 0}
          onChange={(value) => setDetail((current) => ({ ...current, [dimension.key]: value }))}
        />
      ))}

      <Field label="Write a review (optional)">
        <Textarea
          placeholder="What went well?"
          value={review}
          onChange={(event) => setReview(event.target.value)}
          maxLength={1000}
        />
      </Field>

      <Button size="lg" block loading={busy} onClick={() => void submit()}>
        Submit rating
      </Button>
      <p className="tiny subtle center mt-3">Ratings are permanent and cannot be edited.</p>
    </Sheet>
  );
}
