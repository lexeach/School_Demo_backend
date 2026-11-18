# R3 On-Demand Verification Questions (Backend)

- R3 tree generation and deeper factor expansion now create factor metadata only; they do not call the verification-question AI generator.
- New authenticated endpoint: `POST /api/r3/questions` with `{ paperId, questionId, questionNumber, factorId }`.
- The endpoint generates exactly three new MCQs and stores the active question set against the current user's existing `R3FactorProgress` record. Correct answers remain server-side.
- `POST /api/r3/verify` now requires `attemptId`, validates answers against that user's active set, and rejects stale/replayed sets.
- Each completed attempt appends a snapshot to `R3FactorProgress.attemptHistory`: attempt ID/date, question text, options, correct answer, selected answer, per-question correctness, score, total and status.
- No new collection or migration is introduced. Existing question IDs and R3 factor IDs remain untouched for existing records.
- Duplicate prevention compares generated questions with that user's earlier attempt snapshots and retries generation up to four times.

## API sequence

1. `POST /api/r3/generate` — get or create R3 factor tree (without verification questions).
2. `POST /api/r3/questions` — generate a fresh set for a factor.
3. `POST /api/r3/verify` — submit `{ paperId, questionId, questionNumber, factorId, attemptId, answers: ["A", "B", "C"] }`.

Deploy the backend before the frontend so the new `/api/r3/questions` endpoint is available.
