import prisma from '../config/database.js';

/**
 * Inventory is enterprise-wide — all data lives under one farm (the enterprise farm).
 * When a BU farm is selected, resolve to the enterprise farm and filter by matching location.
 *
 * Returns: { farmId, locationId, hasLocation }
 *   - farmId: the enterprise farm that holds inventory data
 *   - locationId: the matching inventory location for BU filtering (or null)
 *   - hasLocation: false when a BU has no inventory location (e.g. Provost) — callers should show empty
 */
export async function resolveInventoryFarm(requestedFarmId) {
  // Find the enterprise farm (the one that actually holds inventory data)
  const hasBins = await prisma.inventoryBin.count({ where: { farm_id: requestedFarmId }, take: 1 });
  let enterpriseFarmId;

  if (hasBins > 0) {
    enterpriseFarmId = requestedFarmId;
  } else {
    const entry = await prisma.inventoryBin.findFirst({ select: { farm_id: true } });
    if (!entry) {
      return { farmId: requestedFarmId, locationId: null, hasLocation: false };
    }
    enterpriseFarmId = entry.farm_id;
  }

  // Always try to match the requested farm name to an inventory location
  const farm = await prisma.farm.findUnique({ where: { id: requestedFarmId }, select: { name: true } });
  const location = farm
    ? await prisma.inventoryLocation.findFirst({
        where: { farm_id: enterpriseFarmId, name: farm.name },
        select: { id: true },
      })
    : null;

  return {
    farmId: enterpriseFarmId,
    locationId: location?.id || null,
    // true when: it's the enterprise farm itself, OR the BU has a matching inventory location
    hasLocation: requestedFarmId === enterpriseFarmId || !!location,
  };
}
