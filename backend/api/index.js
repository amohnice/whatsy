// Vercel serverless entrypoint. Express apps are valid Node request handlers,
// so exporting the app is all Vercel needs — note there is NO listen() call.
// Store initialisation happens in an app-level middleware (see src/app.js),
// because serverless has no startup hook.
import app from '../src/app.js';

export default app;
