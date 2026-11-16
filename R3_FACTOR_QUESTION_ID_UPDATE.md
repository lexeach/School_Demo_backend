# R3 Factor question lookup key

The current Paper schema stores `questions` as `[Object]`. Those question objects contain `questionNumber` but do not have Mongoose subdocument `_id` values. R3 therefore uses the existing `questionNumber`, scoped by `paper`, as its stable lookup key.

- No question ID is generated, regenerated, or modified.
- No `Paper.questions` records are modified.
- R3 structure is keyed by `paper + questionNumber` (stored in the API/model field `questionId` as a string).
- Student progress is keyed by `paper + questionNumber + user + factorId`.
- Question number remains the existing identifier/order value from the paper.
- The migration backfills only R3 records' lookup key from their existing `questionIndex`, then replaces obsolete R3 indexes. It does not touch question documents.
- Existing I Learnt endpoints and models are unchanged.

## One-time database index migration

Run once using the backend's existing `MONGO_URI`:

`node scripts/migrate-r3-question-id-indexes.js`

Then deploy backend and frontend ZIPs.
