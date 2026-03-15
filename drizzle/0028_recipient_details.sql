-- Add recipient name + email to document_comparisons
ALTER TABLE document_comparisons
  ADD COLUMN IF NOT EXISTS recipient_name  text,
  ADD COLUMN IF NOT EXISTS recipient_email text;

-- Add party_b_name to proposals
ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS party_b_name text;
