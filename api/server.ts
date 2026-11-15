import { app, startServer } from '../server.ts';

// Enregistrer les routes (startServer ne fait pas app.listen() sur Vercel)
startServer();

export default app;
