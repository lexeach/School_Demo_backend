# R3 On-Demand Learning Content Update

## Behaviour
- R3 tree generation creates the factor hierarchy and each factor's 3-question verification set only.
- Learning content is not generated during initial R3 generation or deeper-factor expansion.
- The Learning tab shows saved content when present; otherwise it shows **Generate Learning Content**.
- Clicking the button calls `POST /api/r3/learning-content`.
- The backend creates approximately 150–200 words in the paper's configured language and class level.
- Content is saved on the existing R3 document under the factor belonging to the existing paper + questionId. No student-specific learning-content record or new collection is introduced.
- If content already exists, the endpoint returns it without making another AI call.

## Files changed

### Frontend
- `src/components/L3_R3FactorDialog.tsx`
- `src/service/learningVerification.ts`
- `src/config/url-constants.ts`

### Backend
- `controllers/r3Factor.controller.js`
- `routes/r3Factor.routes.js`

## Deployment
1. Deploy the updated backend project to Render.
2. Deploy the updated frontend project to Netlify.
3. No MongoDB migration is required; the existing `learningContent` field is reused.
4. No question IDs, verification questions, verification pass criteria, or R3 progress records are changed by this feature.

## Validation
- Backend changed JavaScript files pass `node --check`.
- Frontend changed TypeScript/TSX files pass TypeScript transpile syntax checks.
- A full Vite production build was not run in this environment because project dependencies are not installed here.
