import 'dotenv/config';
import { createServer } from 'http';
import { Server } from 'socket.io';
import app from './app.js';
import { setupSocketHandlers } from './socket/handler.js';

// Validate required environment variables
if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set');
  process.exit(1);
}

if (process.env.NODE_ENV === 'production' && process.env.JWT_SECRET === 'dev-secret-change-in-production') {
  console.error('FATAL: JWT_SECRET is set to the default dev value. Generate a secure secret: openssl rand -base64 32');
  process.exit(1);
}

const PORT = process.env.PORT || 3001;

const httpServer = createServer(app);

// CORS — lock down in production via CORS_ORIGIN env var
const corsOrigin = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(s => s.trim())
  : true;

const io = new Server(httpServer, {
  cors: { origin: corsOrigin, credentials: true },
});

setupSocketHandlers(io);

// Make io accessible to routes
app.set('io', io);

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
