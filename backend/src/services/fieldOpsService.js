import jwt from 'jsonwebtoken';
import prisma from '../config/database.js';
import { encrypt, decrypt } from '../utils/crypto.js';

// ─── CNH FieldOps OAuth & API Configuration ────────────────────────
// Staging uses stg- prefix; production uses the base domain.
const FIELDOPS_ENV = process.env.FIELDOPS_ENVIRONMENT || 'staging';
const isProduction = FIELDOPS_ENV === 'production';

const AUTH_BASE = isProduction
  ? 'https://identity.cnhind.com'
  : 'https://stg-identity.cnhind.com';

const API_BASE = isProduction
  ? 'https://api-data.cnh.com/v1'
  : 'https://stg.api-data.cnh.com/v1';

const AUDIENCE = isProduction
  ? 'https://api-data.cnh.com/'
  : 'https://stg.api-data.cnh.com/';

const CONNECTION = isProduction
  ? 'PROD-ADFS-CONN'
  : 'STG-ADFS-CONN';

// ─── OAuth: Generate Authorization URL ─────────────────────────────
export function getAuthUrl(farmId, userId) {
  const clientId = process.env.FIELDOPS_CLIENT_ID;
  const redirectUri = process.env.FIELDOPS_REDIRECT_URI;

  if (!clientId) {
    return { fallback: true, message: 'FieldOps not configured.' };
  }

  // Sign the state param so the callback can verify farmId + userId
  const state = jwt.sign({ farmId, userId }, process.env.JWT_SECRET, { expiresIn: '30m' });

  const params = new URLSearchParams({
    response_type: 'code',
    scope: 'offline_access',
    client_id: clientId,
    redirect_uri: redirectUri,
    audience: AUDIENCE,
    connection: CONNECTION,
    state,
  });

  return { url: `${AUTH_BASE}/authorize?${params.toString()}` };
}

// ─── OAuth: Exchange code for tokens ───────────────────────────────
export async function handleCallback(code, state) {
  // Verify and decode the signed state parameter
  let farmId;
  try {
    const decoded = jwt.verify(state, process.env.JWT_SECRET);
    farmId = decoded.farmId;
  } catch {
    throw new Error('Invalid or expired OAuth state parameter');
  }

  if (!farmId) throw new Error('Missing farmId in OAuth state');

  // Exchange authorization code for access + refresh tokens
  const res = await fetch(`${AUTH_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: process.env.FIELDOPS_CLIENT_ID,
      client_secret: process.env.FIELDOPS_CLIENT_SECRET,
      redirect_uri: process.env.FIELDOPS_REDIRECT_URI,
      code,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`FieldOps token exchange failed (${res.status}): ${body}`);
  }

  const tokens = await res.json();
  const expiresAt = new Date(Date.now() + (tokens.expires_in || 21600) * 1000);

  await prisma.fieldOpsToken.upsert({
    where: { farm_id: farmId },
    update: {
      access_token: encrypt(tokens.access_token),
      refresh_token: encrypt(tokens.refresh_token),
      expires_at: expiresAt,
    },
    create: {
      farm_id: farmId,
      access_token: encrypt(tokens.access_token),
      refresh_token: encrypt(tokens.refresh_token),
      expires_at: expiresAt,
    },
  });

  return { success: true, farmId };
}

// ─── OAuth: Refresh access token ───────────────────────────────────
async function refreshAccessToken(farmId) {
  const record = await prisma.fieldOpsToken.findUnique({ where: { farm_id: farmId } });
  if (!record) throw new Error('FieldOps not connected for this farm');

  const refreshToken = decrypt(record.refresh_token);

  const res = await fetch(`${AUTH_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: process.env.FIELDOPS_CLIENT_ID,
      client_secret: process.env.FIELDOPS_CLIENT_SECRET,
      redirect_uri: process.env.FIELDOPS_REDIRECT_URI,
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    // If refresh fails, the connection is stale — remove it
    await prisma.fieldOpsToken.delete({ where: { farm_id: farmId } }).catch(() => {});
    throw new Error(`FieldOps token refresh failed (${res.status}): ${body}`);
  }

  const tokens = await res.json();
  const expiresAt = new Date(Date.now() + (tokens.expires_in || 21600) * 1000);

  await prisma.fieldOpsToken.update({
    where: { farm_id: farmId },
    data: {
      access_token: encrypt(tokens.access_token),
      refresh_token: tokens.refresh_token ? encrypt(tokens.refresh_token) : record.refresh_token,
      expires_at: expiresAt,
    },
  });

  return tokens.access_token;
}

// ─── Get a valid access token (auto-refresh if expired) ────────────
async function getAccessToken(farmId) {
  const record = await prisma.fieldOpsToken.findUnique({ where: { farm_id: farmId } });
  if (!record) throw new Error('FieldOps not connected for this farm');

  // Refresh if token expires within the next 5 minutes
  if (record.expires_at <= new Date(Date.now() + 5 * 60 * 1000)) {
    return refreshAccessToken(farmId);
  }

  return decrypt(record.access_token);
}

// ─── Generic FieldOps API caller ───────────────────────────────────
export async function fieldOpsApi(farmId, path, options = {}) {
  const accessToken = await getAccessToken(farmId);

  const res = await fetch(`${API_BASE}${path}`, {
    method: options.method || 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Ocp-Apim-Subscription-Key': process.env.FIELDOPS_SUBSCRIPTION_KEY,
      ...options.headers,
    },
    body: options.body,
  });

  if (res.status === 401) {
    // Token might have been revoked server-side — try one refresh
    const freshToken = await refreshAccessToken(farmId);
    const retry = await fetch(`${API_BASE}${path}`, {
      method: options.method || 'GET',
      headers: {
        'Authorization': `Bearer ${freshToken}`,
        'Ocp-Apim-Subscription-Key': process.env.FIELDOPS_SUBSCRIPTION_KEY,
        ...options.headers,
      },
      body: options.body,
    });
    if (!retry.ok) {
      const body = await retry.text();
      throw new Error(`FieldOps API error (${retry.status}): ${body}`);
    }
    return retry.json();
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`FieldOps API error (${res.status}): ${body}`);
  }

  return res.json();
}

// ─── Connection status ─────────────────────────────────────────────
export async function getConnectionStatus(farmId) {
  const record = await prisma.fieldOpsToken.findUnique({ where: { farm_id: farmId } });
  if (!record) return { connected: false };

  return {
    connected: true,
    connected_at: record.connected_at,
    expires_at: record.expires_at,
    expired: record.expires_at <= new Date(),
  };
}

// ─── Disconnect (revoke + delete) ──────────────────────────────────
export async function disconnect(farmId) {
  const record = await prisma.fieldOpsToken.findUnique({ where: { farm_id: farmId } });
  if (!record) return { success: true };

  // Best-effort revoke at CNH
  try {
    const refreshToken = decrypt(record.refresh_token);
    await fetch(`${AUTH_BASE}/oauth/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.FIELDOPS_CLIENT_ID,
        client_secret: process.env.FIELDOPS_CLIENT_SECRET,
        token: refreshToken,
      }),
    });
  } catch {
    // Revoke is best-effort
  }

  await prisma.fieldOpsToken.delete({ where: { farm_id: farmId } });
  return { success: true };
}

// ─── Convenience: Equipment endpoints ──────────────────────────────
export async function getFleet(farmId, page = 1) {
  return fieldOpsApi(farmId, `/Fleet/${page}`);
}

export async function getEquipment(farmId, vin) {
  return fieldOpsApi(farmId, `/Fleet/Equipment/${vin}`);
}

export async function getEquipmentLocations(farmId, vin, startDate, endDate, page = 1) {
  return fieldOpsApi(farmId, `/Fleet/Equipment/${vin}/Locations/${startDate}/${endDate}/${page}`);
}

export async function getEquipmentFuelUsed(farmId, vin, startDate, endDate, page = 1) {
  return fieldOpsApi(farmId, `/Fleet/Equipment/${vin}/FuelUsedInThePreceding24Hours/${startDate}/${endDate}/${page}`);
}

export async function getEquipmentEngineHours(farmId, vin, startDate, endDate, page = 1) {
  return fieldOpsApi(farmId, `/Fleet/Equipment/${vin}/CumulativeIdleHours/${startDate}/${endDate}/${page}`);
}

// ─── Convenience: Farm Setup endpoints ─────────────────────────────
export async function getCompanies(farmId) {
  return fieldOpsApi(farmId, '/companies');
}

export async function getFields(farmId, companyId, cFarmId) {
  return fieldOpsApi(farmId, `/companies/${companyId}/farms/${cFarmId}/fields`);
}

export async function getFieldBoundaries(farmId, companyId, fieldId) {
  return fieldOpsApi(farmId, `/companies/${companyId}/fields/${fieldId}/boundaries`);
}
