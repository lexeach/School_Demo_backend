# R3 Factor update — preserve existing question IDs

- The existing `Paper.questions[*]._id` is read as-is. This update does not create, rewrite, regenerate, or migrate question IDs.
- R3 structure is keyed by `paper + questionId`.
- Student progress is keyed by `paper + questionId + user + factorId`.
- Question number is retained only as display/order metadata.
- All three R3 endpoints validate the question ID against the existing Paper document and enforce paper access.
- Existing I Learnt endpoints and models are unchanged.

## One-time database index migration

Before deploying the backend, set the existing `MONGO_URI` in the shell and run:

`node scripts/migrate-r3-question-id-indexes.js`

The script only replaces obsolete unique R3 indexes based on `questionIndex` with indexes based on `questionId`. It does not modify Paper question documents or any question IDs.

Then deploy the backend and frontend ZIPs. R3 requires each question object to already contain its existing `_id`. If an existing question has no `_id`, the API returns a clear error rather than inventing one.
