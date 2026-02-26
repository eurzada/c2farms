import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import authRoutes from './routes/auth.js';
import assumptionsRoutes from './routes/assumptions.js';
import financialRoutes from './routes/financial.js';
import forecastRoutes from './routes/forecast.js';
import { qbGeneralRouter, qbFarmRouter } from './routes/quickbooks.js';
import dashboardRoutes from './routes/dashboard.js';
import exportsRoutes from './routes/exports.js';
import agronomyRoutes from './routes/agronomy.js';
import farmRoutes from './routes/farms.js';
import csvImportRoutes from './routes/csvImport.js';
import chartOfAccountsRoutes from './routes/chartOfAccounts.js';
import settingsRoutes from './routes/settings.js';
import aiRoutes from './routes/ai.js';
import operationalDataRoutes from './routes/operationalData.js';
import { errorHandler } from './middleware/errorHandler.js';
import { authenticate, requireFarmAccess } from './middleware/auth.js';

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);

// Enforce farm-level authorization on all /:farmId/* routes
app.use('/api/farms/:farmId', authenticate, requireFarmAccess);

app.use('/api/farms', assumptionsRoutes);
app.use('/api/farms', financialRoutes);
app.use('/api/farms', forecastRoutes);
app.use('/api/quickbooks', qbGeneralRouter);
app.use('/api/farms', qbFarmRouter);
app.use('/api/farms', dashboardRoutes);
app.use('/api/farms', exportsRoutes);
app.use('/api/farms', agronomyRoutes);
app.use('/api/farms', farmRoutes);
app.use('/api/farms', csvImportRoutes);
app.use('/api/farms', chartOfAccountsRoutes);
app.use('/api/farms', settingsRoutes);
app.use('/api/farms', aiRoutes);
app.use('/api/farms', operationalDataRoutes);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve frontend static files in production
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDist = path.join(__dirname, '../../frontend/dist');
app.use(express.static(frontendDist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(frontendDist, 'index.html'));
});

app.use(errorHandler);

export default app;
