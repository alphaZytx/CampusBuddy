/**
 * Shared SQL for reading requests.
 *
 * One projection is used by the feed, the detail screen and the dashboards, so a
 * request always arrives at the client in exactly the same shape — including the
 * viewer-relative parts (my offer, distance from me) which are computed in the
 * database rather than in a second round trip.
 *
 * Parameter convention for every query built on this fragment:
 *   $1 = viewer id, $2 = viewer latitude (nullable), $3 = viewer longitude (nullable)
 */
export const REQUEST_SELECT = `
  SELECT
    r.id, r.campus_id, r.title, r.description, r.category_slug, r.subcategory,
    r.reward_paise, r.product_cost_paise, r.total_budget_paise, r.max_reward_paise,
    r.auto_escalate, r.pickup_label, r.pickup_lat, r.pickup_lng,
    r.delivery_label, r.delivery_lat, r.delivery_lng,
    r.exact_lat, r.exact_lng, r.approx_lat, r.approx_lng,
    r.deadline_at, r.scheduled_for, r.urgency, r.visibility, r.status,
    r.requester_id, r.selected_helper_id, r.offer_count,
    r.completion_note, r.cancellation_reason, r.rejection_reason,
    r.created_at, r.updated_at, r.completed_at, r.confirmed_at,

    to_jsonb(rp)                                        AS requester,
    CASE WHEN hp.id IS NOT NULL THEN to_jsonb(hp) END   AS selected_helper,

    -- Distance from the viewer, when both sides have shared a position.
    CASE
      WHEN $2::double precision IS NULL OR r.approx_lat IS NULL THEN NULL
      ELSE haversine_metres($2::double precision, $3::double precision, r.approx_lat, r.approx_lng)
    END AS distance_metres,

    -- The viewer's own offer, so the feed can show "Offer sent" without a second query.
    (
      SELECT to_jsonb(o) || jsonb_build_object('helper', to_jsonb(op))
        FROM request_offers o
        JOIN public_user_profiles op ON op.id = o.helper_id
       WHERE o.request_id = r.id AND o.helper_id = $1::uuid
       LIMIT 1
    ) AS my_offer,

    (
      SELECT to_jsonb(p) || jsonb_build_object(
               'payee_upi_id', pu.upi_id,
               'payee_upi_qr_attachment_id', pu.upi_qr_attachment_id,
               'payee_name', pu.full_name,
               'receipt_attachment', CASE WHEN receipt.id IS NOT NULL THEN to_jsonb(receipt) END)
        FROM payments p
        JOIN users pu ON pu.id = p.payee_id
        LEFT JOIN attachments receipt ON receipt.id = p.receipt_attachment_id
       WHERE p.request_id = r.id
       LIMIT 1
    ) AS payment,

    (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'id', a.id, 'file_name', a.file_name,
               'mime_type', a.mime_type, 'size_bytes', a.size_bytes)
             ORDER BY ra.sort_order), '[]'::jsonb)
        FROM request_attachments ra
        JOIN attachments a ON a.id = ra.attachment_id
       WHERE ra.request_id = r.id
    ) AS attachments,

    (
      SELECT to_jsonb(pr) FROM attachments pr WHERE pr.id = r.completion_proof_id
    ) AS completion_proof,

    EXISTS (
      SELECT 1 FROM ratings rt
       WHERE rt.request_id = r.id AND rt.rater_id = $1::uuid
    ) AS my_rating_submitted

  FROM requests r
  JOIN public_user_profiles rp      ON rp.id = r.requester_id
  LEFT JOIN public_user_profiles hp ON hp.id = r.selected_helper_id
`;
