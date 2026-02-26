import jwt from 'jsonwebtoken';
import prisma from '../config/database.js';
import { encrypt, decrypt } from '../utils/crypto.js';

// QuickBooks OAuth2 placeholder
export function getAuthUrl(farmId, userId) {
  const clientId = process.env.QB_CLIENT_ID;
  const redirectUri = process.env.QB_REDIRECT_URI;

  if (!clientId) {
    return { fallback: true, message: 'QuickBooks not configured. Please enter actuals manually.' };
  }

  // Sign the state param so the callback can verify farmId + userId
  const state = jwt.sign({ farmId, userId }, process.env.JWT_SECRET, { expiresIn: '30m' });
  const url = `https://appcenter.intuit.com/connect/oauth2?client_id=${clientId}&response_type=code&scope=com.intuit.quickbooks.accounting&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;
  return { url };
}

export async function handleCallback(code, realmId, state) {
  // Verify and decode the signed state parameter
  let farmId;
  try {
    const decoded = jwt.verify(state, process.env.JWT_SECRET);
    farmId = decoded.farmId;
  } catch {
    throw new Error('Invalid or expired OAuth state parameter');
  }

  if (!farmId) {
    throw new Error('Missing farmId in OAuth state');
  }

  // Placeholder: In production, exchange code for tokens
  await prisma.qbToken.upsert({
    where: { farm_id: farmId },
    update: {
      access_token: encrypt('placeholder_access_token'),
      refresh_token: encrypt('placeholder_refresh_token'),
      realm_id: realmId || 'placeholder',
      expires_at: new Date(Date.now() + 3600000),
    },
    create: {
      farm_id: farmId,
      access_token: encrypt('placeholder_access_token'),
      refresh_token: encrypt('placeholder_refresh_token'),
      realm_id: realmId || 'placeholder',
      expires_at: new Date(Date.now() + 3600000),
    },
  });

  return { success: true };
}

export async function syncExpenses(farmId, _startDate, _endDate, _fiscalYear) {
  // Check if QB tokens exist
  const tokensRaw = await prisma.qbToken.findUnique({ where: { farm_id: farmId } });

  if (!tokensRaw || !process.env.QB_CLIENT_ID) {
    return {
      fallback: true,
      message: 'QuickBooks is not connected. Please enter actuals manually.',
    };
  }

  // Decrypt tokens for API use
  const _accessToken = decrypt(tokensRaw.access_token);
  const _refreshToken = decrypt(tokensRaw.refresh_token);

  try {
    // Placeholder: In production, make API call to QB using _accessToken/_refreshToken
    // For MVP, return fallback
    throw new Error('QB API not implemented');
  } catch (err) {
    return {
      fallback: true,
      message: `QuickBooks sync failed: ${err.message}. Please enter actuals manually.`,
    };
  }
}

export async function getMappings(farmId) {
  return prisma.qbCategoryMapping.findMany({
    where: { farm_id: farmId },
  });
}

export async function upsertMapping(farmId, qbAccountName, categoryCode, weight = 1.0) {
  return prisma.qbCategoryMapping.upsert({
    where: {
      farm_id_qb_account_name: { farm_id: farmId, qb_account_name: qbAccountName },
    },
    update: { category_code: categoryCode, weight },
    create: { farm_id: farmId, qb_account_name: qbAccountName, category_code: categoryCode, weight },
  });
}
