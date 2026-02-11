-- Migration: 017_karma_notifications
-- Description: Add karma tracking to users, create notifications table, extend vote trigger

-- 1a. Add karma + last-viewed columns to users
ALTER TABLE users ADD COLUMN vote_karma INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN connection_karma INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN notifications_last_viewed_at TIMESTAMPTZ;

-- 1b. Create notifications table
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id VARCHAR(64) NOT NULL REFERENCES users(id),
    target_type vote_target_type NOT NULL,
    target_id UUID NOT NULL,
    reply_count INTEGER NOT NULL DEFAULT 1,
    last_reply_author_id VARCHAR(64) REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_user_notification UNIQUE (user_id, target_type, target_id)
);

CREATE INDEX idx_notifications_user_updated ON notifications(user_id, updated_at DESC);

CREATE TRIGGER update_notifications_updated_at
    BEFORE UPDATE ON notifications
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 1c. Extend update_target_score() to also update author's vote_karma
CREATE OR REPLACE FUNCTION update_target_score()
RETURNS TRIGGER AS $$
DECLARE
    score_delta INTEGER;
    content_author_id VARCHAR(64);
BEGIN
    -- Calculate score change
    IF TG_OP = 'INSERT' THEN
        score_delta := NEW.value;
    ELSIF TG_OP = 'UPDATE' THEN
        score_delta := NEW.value - OLD.value;
    ELSIF TG_OP = 'DELETE' THEN
        score_delta := -OLD.value;
    END IF;

    -- Apply score change to appropriate table and get author
    IF TG_OP = 'DELETE' THEN
        IF OLD.target_type = 'post' THEN
            UPDATE posts SET score = score + score_delta WHERE id = OLD.target_id
            RETURNING author_id INTO content_author_id;
        ELSE
            UPDATE replies SET score = score + score_delta WHERE id = OLD.target_id
            RETURNING author_id INTO content_author_id;
        END IF;
    ELSE
        IF NEW.target_type = 'post' THEN
            UPDATE posts SET score = score + score_delta WHERE id = NEW.target_id
            RETURNING author_id INTO content_author_id;
        ELSE
            UPDATE replies SET score = score + score_delta WHERE id = NEW.target_id
            RETURNING author_id INTO content_author_id;
        END IF;
    END IF;

    -- Update author's vote_karma
    IF content_author_id IS NOT NULL AND score_delta != 0 THEN
        UPDATE users SET vote_karma = vote_karma + score_delta WHERE id = content_author_id;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 1d. Backfill vote_karma from existing votes
UPDATE users u
SET vote_karma = COALESCE(sub.total, 0)
FROM (
    SELECT author_id, SUM(v.value) AS total
    FROM (
        SELECT p.author_id, v.value
        FROM votes v
        JOIN posts p ON v.target_type = 'post' AND v.target_id = p.id
        UNION ALL
        SELECT r.author_id, v.value
        FROM votes v
        JOIN replies r ON v.target_type = 'reply' AND v.target_id = r.id
    ) AS v(author_id, value)
    GROUP BY author_id
) sub
WHERE u.id = sub.author_id;

-- Backfill connection_karma from existing replies (excluding self-replies)
UPDATE users u
SET connection_karma = COALESCE(sub.total, 0)
FROM (
    SELECT credited_user, SUM(cnt) AS total
    FROM (
        SELECT p.author_id AS credited_user, COUNT(*) AS cnt
        FROM replies r
        JOIN posts p ON r.post_id = p.id
        WHERE r.parent_reply_id IS NULL
          AND r.author_id != p.author_id
          AND r.deleted_at IS NULL
        GROUP BY p.author_id

        UNION ALL

        SELECT pr.author_id AS credited_user, COUNT(*) AS cnt
        FROM replies r
        JOIN replies pr ON r.parent_reply_id = pr.id
        WHERE r.author_id != pr.author_id
          AND r.deleted_at IS NULL
        GROUP BY pr.author_id
    ) parts
    GROUP BY credited_user
) sub
WHERE u.id = sub.credited_user;

-- Backfill notifications from existing replies
INSERT INTO notifications (user_id, target_type, target_id, reply_count, last_reply_author_id, created_at, updated_at)
SELECT
    credited_user,
    target_type::vote_target_type,
    target_id,
    reply_count,
    last_reply_author_id,
    first_reply_at,
    last_reply_at
FROM (
    -- Top-level replies grouped by (post_author, 'post', post_id)
    SELECT
        p.author_id AS credited_user,
        'post' AS target_type,
        r.post_id AS target_id,
        COUNT(*) AS reply_count,
        (ARRAY_AGG(r.author_id ORDER BY r.created_at DESC))[1] AS last_reply_author_id,
        MIN(r.created_at) AS first_reply_at,
        MAX(r.created_at) AS last_reply_at
    FROM replies r
    JOIN posts p ON r.post_id = p.id
    WHERE r.parent_reply_id IS NULL
      AND r.author_id != p.author_id
      AND r.deleted_at IS NULL
    GROUP BY p.author_id, r.post_id

    UNION ALL

    -- Nested replies grouped by (parent_reply_author, 'reply', parent_reply_id)
    SELECT
        pr.author_id AS credited_user,
        'reply' AS target_type,
        r.parent_reply_id AS target_id,
        COUNT(*) AS reply_count,
        (ARRAY_AGG(r.author_id ORDER BY r.created_at DESC))[1] AS last_reply_author_id,
        MIN(r.created_at) AS first_reply_at,
        MAX(r.created_at) AS last_reply_at
    FROM replies r
    JOIN replies pr ON r.parent_reply_id = pr.id
    WHERE r.author_id != pr.author_id
      AND r.deleted_at IS NULL
    GROUP BY pr.author_id, r.parent_reply_id
) backfill
ON CONFLICT (user_id, target_type, target_id) DO UPDATE
SET reply_count = EXCLUDED.reply_count,
    last_reply_author_id = EXCLUDED.last_reply_author_id,
    updated_at = EXCLUDED.updated_at;
