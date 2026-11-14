-- Adds output of the Reasoning agent (risk hypotheses) and the Reviewer agent (decision brief for humans).
-- Neither column is ever read by the risk engine or the gate: they are advisory evidence for people.
ALTER TABLE assessments ADD COLUMN hypotheses jsonb;
ALTER TABLE assessments ADD COLUMN review_brief jsonb;
