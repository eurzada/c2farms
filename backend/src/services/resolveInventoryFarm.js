import prisma from '../config/database.js';

/**
 * Enterprise-wide data (inventory, marketing, logistics) lives under the
 * dedicated Enterprise farm (is_enterprise = true in the DB).
 *
 * When a BU farm is selected, resolve to the Enterprise farm and find the
 * matching inventory location for filtering.
 *
 * Returns: { farmId, locationId, hasLocation }
 *   - farmId: the Enterprise farm that holds all enterprise-wide data
 *   - locationId: the matching inventory location for BU filtering (or null)
 *   - hasLocation: false when a BU has no inventory location (e.g. Provost)
 */

let _cachedEnterpriseFarmId = null;

async function getEnterpriseFarmId() {
  if (_cachedEnterpriseFarmId) return _cachedEnterpriseFarmId;
  const farm = await prisma.farm.findFirst({
    where: { is_enterprise: true },
    select: { id: true },
  });
  if (farm) _cachedEnterpriseFarmId = farm.id;
  return farm?.id || null;
}

export async function resolveInventoryFarm(requestedFarmId) {
  const enterpriseFarmId = await getEnterpriseFarmId();

  if (!enterpriseFarmId) {
    // No enterprise farm configured — fall back to requested farm
    return { farmId: requestedFarmId, locationId: null, hasLocation: false };
  }

  // If the request is already for the enterprise farm, no location filtering
  if (requestedFarmId === enterpriseFarmId) {
    return { farmId: enterpriseFarmId, locationId: null, hasLocation: true };
  }

  // BU farm — try to match its name to an inventory location
  const farm = await prisma.farm.findUnique({
    where: { id: requestedFarmId },
    select: { name: true },
  });
  const location = farm
    ? await prisma.inventoryLocation.findFirst({
        where: { farm_id: enterpriseFarmId, name: farm.name },
        select: { id: true },
      })
    : null;

  return {
    farmId: enterpriseFarmId,
    locationId: location?.id || null,
    hasLocation: !!location,
  };
}

// Expose for use in FarmContext-style lookups
export { getEnterpriseFarmId };
