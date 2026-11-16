# R3 Factor deployment

1. Deploy the backend ZIP to the existing Render backend service.
2. No new environment variables are required; R3 uses the existing AI provider configuration.
3. Ensure the MongoDB user can create collections and indexes. The new collections are `r3factors` and `r3factorprogress`.
4. Backend routes are mounted at `/api/r3`:
   - POST `/api/r3/generate`
   - POST `/api/r3/verify`
   - POST `/api/r3/expand`
5. The original question is referenced by `paperId + questionNumber`. R3 structure and factor question sets are shared per original question; verification progress is stored per authenticated user.
6. Verify the authenticated user's access to the paper before production use. The controller checks paper author/authorId and the linked child's owner/parent.
