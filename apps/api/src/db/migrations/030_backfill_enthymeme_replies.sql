-- Backfill enthymemes as normal replies authored by assumption-bot.
-- For each enthymeme, find its source post/reply via the scheme → analysis_run chain.
-- Top-level enthymemes (source is a post) get no parent_reply_id.
-- Enthymemes whose source is a reply are threaded as children of that reply.

DO $$
DECLARE
  rec RECORD;
  new_reply_id UUID;
  parent_path TEXT;
  reply_depth INTEGER;
BEGIN
  FOR rec IN
    SELECT
      e.id      AS enthymeme_id,
      e.content AS content,
      r.source_type,
      r.source_id
    FROM v3_enthymemes e
    JOIN v3_nodes_s       s ON s.id = e.scheme_id
    JOIN v3_analysis_runs r ON r.id = s.analysis_run_id
    ORDER BY e.created_at
  LOOP
    IF rec.source_type = 'post' THEN
      INSERT INTO replies (
        post_id,
        author_id,
        parent_reply_id,
        content,
        analysis_content_hash,
        depth,
        path
      )
      VALUES (
        rec.source_id,
        'assumption-bot',
        NULL,
        rec.content,
        md5(rec.content),
        0,
        'placeholder'::ltree   -- updated below
      )
      RETURNING id INTO new_reply_id;

      UPDATE replies
         SET path = text2ltree(replace(new_reply_id::text, '-', '_'))
       WHERE id = new_reply_id;

    ELSIF rec.source_type = 'reply' THEN
      SELECT path, depth
        INTO parent_path, reply_depth
        FROM replies
       WHERE id = rec.source_id;

      IF NOT FOUND THEN
        CONTINUE;
      END IF;

      INSERT INTO replies (
        post_id,
        author_id,
        parent_reply_id,
        content,
        analysis_content_hash,
        depth,
        path
      )
      SELECT
        r.post_id,
        'assumption-bot',
        rec.source_id,
        rec.content,
        md5(rec.content),
        reply_depth + 1,
        'placeholder'::ltree
      FROM replies r
      WHERE r.id = rec.source_id
      RETURNING id INTO new_reply_id;

      UPDATE replies
         SET path = text2ltree(parent_path || '.' || replace(new_reply_id::text, '-', '_'))
       WHERE id = new_reply_id;

      UPDATE replies
         SET reply_count = reply_count + 1
       WHERE id = rec.source_id;
    END IF;
  END LOOP;
END $$;
