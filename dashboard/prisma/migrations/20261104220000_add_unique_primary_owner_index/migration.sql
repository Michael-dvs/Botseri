-- 1. Pre-migration cleanup: Reset is_primary = false jika ada lebih dari 1 baris, sisakan baris tertua
WITH ranked_owners AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC) as rn
  FROM authorized_numbers
  WHERE is_primary = true
)
UPDATE authorized_numbers
SET is_primary = false
WHERE id IN (
  SELECT id FROM ranked_owners WHERE rn > 1
);

-- 2. Create partial unique index for single primary owner in PostgreSQL
CREATE UNIQUE INDEX "authorized_numbers_one_primary"
ON "authorized_numbers" ("is_primary")
WHERE "is_primary" = true;
