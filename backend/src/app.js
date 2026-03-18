import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import authRoutes from './routes/auth.js';
import assumptionsRoutes from './routes/assumptions.js';
import financialRoutes from './routes/financial.js';
import forecastRoutes from './routes/forecast.js';
import { qbGeneralRouter, qbFarmRouter } from './routes/quickbooks.js';
import dashboardRoutes from './routes/dashboard.js';
import exportsRoutes from './routes/exports.js';
import agronomyRoutes, { agronomyGeneralRouter } from './routes/agronomy.js';
import farmRoutes from './routes/farms.js';
import csvImportRoutes from './routes/csvImport.js';
import chartOfAccountsRoutes from './routes/chartOfAccounts.js';
import settingsRoutes from './routes/settings.js';
import aiRoutes from './routes/ai.js';
import operationalDataRoutes from './routes/operationalData.js';
import universalSettingsRoutes from './routes/universalSettings.js';
import inventoryRoutes from './routes/inventory.js';
import contractRoutes from './routes/contracts.js';
import reconciliationRoutes from './routes/reconciliation.js';
import inventoryDashboardRoutes from './routes/inventoryDashboard.js';
import inventoryExportsRoutes from './routes/inventoryExports.js';
import gradingExportsRoutes from './routes/gradingExports.js';
import marketingRoutes from './routes/marketing.js';
import counterpartyRoutes from './routes/counterparties.js';
import cashFlowRoutes from './routes/cashFlowEntries.js';
import priceAlertRoutes from './routes/priceAlerts.js';
import ticketRoutes from './routes/tickets.js';
import settlementRoutes from './routes/settlements.js';
import { fieldOpsGeneralRouter, fieldOpsFarmRouter } from './routes/fieldOps.js';
import mobileTicketRoutes from './routes/mobileTickets.js';
import logisticsDashboardRoutes from './routes/logisticsDashboard.js';
import labourRoutes, { labourGeneralRouter } from './routes/labour.js';
import terminalRoutes from './routes/terminal.js';
import { errorHandler } from './middleware/errorHandler.js';
import { authenticate, requireFarmAccess, requireModule } from './middleware/auth.js';

const app = express();

// Security headers — disable CSP so the React SPA can load inline scripts/styles
app.use(helmet({ contentSecurityPolicy: false }));

// CORS — lock down in production via CORS_ORIGIN env var
const corsOrigin = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(s => s.trim())
  : true;
app.use(cors({ origin: corsOrigin, credentials: true }));

app.use(express.json({ limit: '20mb' }));

// Rate limiting
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later' },
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many registration attempts, please try again later' },
});

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

// Health check — before rate limiter so Render health checks are never throttled
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/', generalLimiter);
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth/register', registerLimiter);

// Routes
app.use('/api/auth', authRoutes);

// Enforce farm-level authorization on all /:farmId/* routes
app.use('/api/farms/:farmId', authenticate, requireFarmAccess);

// Forecast module
app.use('/api/farms', assumptionsRoutes);
app.use('/api/farms', financialRoutes);
app.use('/api/farms', forecastRoutes);
app.use('/api/quickbooks', qbGeneralRouter);
app.use('/api/farms', qbFarmRouter);
app.use('/api/fieldops', fieldOpsGeneralRouter);
app.use('/api/farms', fieldOpsFarmRouter);
app.use('/api/farms', dashboardRoutes);
app.use('/api/farms', exportsRoutes);
app.use('/api/farms', csvImportRoutes);
app.use('/api/farms', operationalDataRoutes);

// Agronomy module
app.use('/api/agronomy', agronomyGeneralRouter);
app.use('/api/farms/:farmId/agronomy', authenticate, requireModule('agronomy'));
app.use('/api/farms', agronomyRoutes);

// Labour planning module
app.use('/api/labour', labourGeneralRouter);
app.use('/api/farms', labourRoutes);

// Core farm management (no module gate — always accessible)
app.use('/api/farms', farmRoutes);
app.use('/api/farms', chartOfAccountsRoutes);
app.use('/api/farms', settingsRoutes);
app.use('/api/farms', aiRoutes);
app.use('/api/admin', universalSettingsRoutes);

// Inventory module
app.use('/api/farms/:farmId/inventory', authenticate, requireModule('inventory'));
app.use('/api/farms', inventoryRoutes);
app.use('/api/farms', contractRoutes);
app.use('/api/farms', reconciliationRoutes);
app.use('/api/farms', inventoryDashboardRoutes);
app.use('/api/farms', inventoryExportsRoutes);
app.use('/api/farms', gradingExportsRoutes);

// Marketing module
app.use('/api/farms/:farmId/marketing', authenticate, requireModule('marketing'));
app.use('/api/farms', marketingRoutes);
app.use('/api/farms', counterpartyRoutes);
app.use('/api/farms', cashFlowRoutes);
app.use('/api/farms', priceAlertRoutes);

// Logistics module
app.use('/api/farms/:farmId/tickets', authenticate, requireModule('logistics'));
app.use('/api/farms/:farmId/settlements', authenticate, requireModule('logistics'));
app.use('/api/farms/:farmId/logistics', authenticate, requireModule('logistics'));
app.use('/api/farms', ticketRoutes);
app.use('/api/farms', settlementRoutes);
app.use('/api/farms', mobileTicketRoutes);
app.use('/api/farms', logisticsDashboardRoutes);

// Terminal operations module (LGX)
app.use('/api/farms/:farmId/terminal', authenticate, requireModule('terminal'));
app.use('/api/farms', terminalRoutes);

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
