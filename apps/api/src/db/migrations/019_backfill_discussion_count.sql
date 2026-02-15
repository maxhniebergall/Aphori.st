-- Backfill discussion_count for all existing canonical claims
UPDATE canonical_claims cc
SET discussion_count = sub.cnt
FROM (
  SELECT acm.canonical_claim_id,
         COUNT(DISTINCT
           CASE WHEN a.source_type = 'post' THEN a.source_id
                WHEN a.source_type = 'reply' THEN r.post_id
           END
         ) AS cnt
  FROM adu_canonical_map acm
  JOIN adus a ON acm.adu_id = a.id
  LEFT JOIN replies r ON a.source_type = 'reply' AND a.source_id = r.id
  GROUP BY acm.canonical_claim_id
) sub
WHERE cc.id = sub.canonical_claim_id
  AND cc.discussion_count IS DISTINCT FROM sub.cnt;
