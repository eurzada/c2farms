import crypto from 'crypto';
import prisma from '../config/database.js';
import createLogger from '../utils/logger.js';

const log = createLogger('traceability');

// Valid event types for traceability blocks
export const EVENT_TYPES = Object.freeze([
  'HARVEST',   // grain enters a bin straight from the field
  'GRADE',     // grading / quality test recorded
  'TRANSFER',  // bin-to-bin or bin-to-truck movement within the farm
  'BLEND',     // multiple lots combined (reduces source lot quantities)
  'SHIP',      // grain leaves the farm toward a buyer / elevator
  'RECEIVE',   // buyer confirmation of receipt
  'CUSTODY',   // custody update without quantity change (e.g. inspection)
  'VOID',      // administrative correction — invalidates a prior event
]);

const GENESIS_PREVIOUS_HASH = '0'.repeat(64);

function getSecret() {
  // HMAC key for block signatures. In production this should be
  // injected via env; we fall back to a stable dev constant so local
  // seeds/tests remain reproducible.
  return process.env.TRACEABILITY_HMAC_SECRET || 'c2farms-dev-traceability-secret';
}

// ─── Canonical JSON + hashing ──────────────────────────────────────

/**
 * Deterministic JSON stringify — sorts object keys recursively so that
 * two logically-equal payloads always produce the same hash regardless
 * of property insertion order. Arrays retain their order.
 */
export function canonicalize(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return '[' + value.map((v) => canonicalize(v)).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  const parts = keys.map((k) => JSON.stringify(k) + ':' + canonicalize(value[k]));
  return '{' + parts.join(',') + '}';
}

export function sha256(input) {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

export function hashPayload(payload) {
  return sha256(canonicalize(payload));
}

export function computeBlockHash({ blockIndex, payloadHash, previousHash, timestamp }) {
  const input = `${blockIndex}|${payloadHash}|${previousHash}|${new Date(timestamp).toISOString()}`;
  return sha256(input);
}

export function signBlock(blockHash) {
  return crypto.createHmac('sha256', getSecret()).update(blockHash).digest('hex');
}

export function verifySignature(blockHash, signature) {
  if (!signature) return false;
  const expected = signBlock(blockHash);
  // timing-safe comparison
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

// ─── Payload normalization ─────────────────────────────────────────

/**
 * Strip nullish / undefined fields and pull only the whitelisted
 * traceability-relevant keys into the canonical payload. This guarantees
 * the hash is stable across API schema changes.
 */
const PAYLOAD_FIELDS = [
  'event_type', 'event_timestamp', 'actor_user_id', 'actor_name',
  'bin_id', 'location_id', 'farm_site', 'destination',
  'crop_year', 'crop_type', 'variety', 'grade',
  'protein_pct', 'moisture_pct', 'dockage_pct', 'test_weight',
  'bushels', 'net_weight_mt',
  'counterparty_id', 'ticket_number', 'contract_number', 'notes',
];

export function buildPayload(event) {
  const out = {};
  for (const key of PAYLOAD_FIELDS) {
    const v = event[key];
    if (v !== undefined && v !== null && v !== '') out[key] = v;
  }
  // Normalize timestamp so canonical JSON is identical across round-trips
  if (out.event_timestamp) {
    out.event_timestamp = new Date(out.event_timestamp).toISOString();
  }
  return out;
}

// ─── Lot + block creation ──────────────────────────────────────────

/**
 * Generate a public lot code, e.g. "C2F-2026-WHT-001".
 * Uses a per-farm+crop_year counter based on existing lots.
 */
export async function generateLotCode(farmId, cropYear, cropType) {
  const cropCode = (cropType || 'GRN').toUpperCase().slice(0, 3);
  const existing = await prisma.traceabilityLot.count({
    where: { farm_id: farmId, crop_year: cropYear },
  });
  const seq = String(existing + 1).padStart(3, '0');
  return `C2F-${cropYear}-${cropCode}-${seq}`;
}

/**
 * Create a new traceability lot along with its genesis block. The genesis
 * block always has event_type = "HARVEST" (or whatever the caller passes
 * as the first event) and previous_hash = 64 zeros.
 */
export async function createLot({
  farmId,
  cropYear,
  cropType,
  variety,
  grade,
  farmSite,
  originBinId,
  originLocationId,
  bushels,
  netWeightMt,
  actorUserId,
  actorName,
  metadata,
  lotCode,
  notes,
}) {
  if (!farmId) throw Object.assign(new Error('farmId is required'), { status: 400 });
  if (!cropYear) throw Object.assign(new Error('cropYear is required'), { status: 400 });
  if (!cropType) throw Object.assign(new Error('cropType is required'), { status: 400 });

  const code = lotCode || await generateLotCode(farmId, cropYear, cropType);

  const event = buildPayload({
    event_type: 'HARVEST',
    event_timestamp: new Date().toISOString(),
    actor_user_id: actorUserId,
    actor_name: actorName,
    bin_id: originBinId,
    location_id: originLocationId,
    farm_site: farmSite,
    crop_year: cropYear,
    crop_type: cropType,
    variety,
    grade,
    bushels,
    net_weight_mt: netWeightMt,
    notes,
  });

  const payloadHash = hashPayload(event);
  const timestamp = new Date();
  const blockHash = computeBlockHash({
    blockIndex: 0,
    payloadHash,
    previousHash: GENESIS_PREVIOUS_HASH,
    timestamp,
  });
  const signature = signBlock(blockHash);

  const lot = await prisma.$transaction(async (tx) => {
    const createdLot = await tx.traceabilityLot.create({
      data: {
        farm_id: farmId,
        lot_code: code,
        crop_year: cropYear,
        crop_type: cropType,
        variety: variety || null,
        grade: grade || null,
        farm_site: farmSite || null,
        origin_bin_id: originBinId || null,
        origin_location_id: originLocationId || null,
        total_bushels: bushels || 0,
        total_mt: netWeightMt || 0,
        genesis_hash: blockHash,
        current_hash: blockHash,
        block_count: 1,
        metadata_json: metadata || null,
        created_by: actorUserId || null,
      },
    });

    await tx.traceabilityBlock.create({
      data: {
        lot_id: createdLot.id,
        farm_id: farmId,
        block_index: 0,
        event_type: 'HARVEST',
        event_timestamp: timestamp,
        actor_user_id: actorUserId || null,
        actor_name: actorName || null,
        bin_id: originBinId || null,
        location_id: originLocationId || null,
        farm_site: farmSite || null,
        crop_year: cropYear,
        crop_type: cropType,
        variety: variety || null,
        grade: grade || null,
        bushels: bushels || null,
        net_weight_mt: netWeightMt || null,
        payload_json: event,
        payload_hash: payloadHash,
        previous_hash: GENESIS_PREVIOUS_HASH,
        block_hash: blockHash,
        signature,
        notes: notes || null,
      },
    });

    return createdLot;
  });

  log.info('lot_created', { lotId: lot.id, lotCode: lot.lot_code, farmId });
  return lot;
}

/**
 * Append an event block to an existing lot, linking it to the current
 * chain tip. Also updates lot.current_hash, block_count, and — if the
 * event changes custody (SHIP/RECEIVE) — the lot status.
 */
export async function appendBlock(lotId, event) {
  if (!lotId) throw Object.assign(new Error('lotId is required'), { status: 400 });
  const eventType = event.event_type;
  if (!eventType || !EVENT_TYPES.includes(eventType)) {
    throw Object.assign(new Error(`Invalid event_type. Must be one of: ${EVENT_TYPES.join(', ')}`), { status: 400 });
  }

  return prisma.$transaction(async (tx) => {
    const lot = await tx.traceabilityLot.findUnique({ where: { id: lotId } });
    if (!lot) throw Object.assign(new Error('Lot not found'), { status: 404 });
    if (lot.status === 'closed' || lot.status === 'voided') {
      throw Object.assign(new Error(`Cannot append to a ${lot.status} lot`), { status: 409 });
    }

    const tip = await tx.traceabilityBlock.findFirst({
      where: { lot_id: lotId },
      orderBy: { block_index: 'desc' },
    });
    if (!tip) throw Object.assign(new Error('Chain is missing a genesis block'), { status: 500 });

    const timestamp = new Date(event.event_timestamp || Date.now());
    const payload = buildPayload({
      ...event,
      event_timestamp: timestamp.toISOString(),
      // default crop identity from the lot if caller omits it
      crop_year: event.crop_year ?? lot.crop_year,
      crop_type: event.crop_type ?? lot.crop_type,
      variety: event.variety ?? lot.variety,
    });

    const payloadHash = hashPayload(payload);
    const blockIndex = tip.block_index + 1;
    const blockHash = computeBlockHash({
      blockIndex,
      payloadHash,
      previousHash: tip.block_hash,
      timestamp,
    });
    const signature = signBlock(blockHash);

    const block = await tx.traceabilityBlock.create({
      data: {
        lot_id: lotId,
        farm_id: lot.farm_id,
        block_index: blockIndex,
        event_type: eventType,
        event_timestamp: timestamp,
        actor_user_id: event.actor_user_id || null,
        actor_name: event.actor_name || null,
        bin_id: event.bin_id || null,
        location_id: event.location_id || null,
        farm_site: event.farm_site || null,
        destination: event.destination || null,
        crop_year: payload.crop_year || null,
        crop_type: payload.crop_type || null,
        variety: payload.variety || null,
        grade: event.grade || null,
        protein_pct: event.protein_pct ?? null,
        moisture_pct: event.moisture_pct ?? null,
        dockage_pct: event.dockage_pct ?? null,
        test_weight: event.test_weight ?? null,
        bushels: event.bushels ?? null,
        net_weight_mt: event.net_weight_mt ?? null,
        counterparty_id: event.counterparty_id || null,
        ticket_number: event.ticket_number || null,
        contract_number: event.contract_number || null,
        payload_json: payload,
        payload_hash: payloadHash,
        previous_hash: tip.block_hash,
        block_hash: blockHash,
        signature,
        notes: event.notes || null,
      },
    });

    // Derive status transitions from the event type
    let nextStatus = lot.status;
    if (eventType === 'SHIP') nextStatus = 'in_transit';
    else if (eventType === 'RECEIVE') nextStatus = 'delivered';
    else if (eventType === 'VOID') nextStatus = 'voided';

    await tx.traceabilityLot.update({
      where: { id: lotId },
      data: {
        current_hash: blockHash,
        block_count: { increment: 1 },
        status: nextStatus,
      },
    });

    return block;
  });
}

// ─── Chain verification ────────────────────────────────────────────

/**
 * Walk a lot's chain from genesis to tip, recomputing every hash and
 * verifying the link structure + HMAC signatures. Returns a structured
 * report of any tampering detected.
 */
export async function verifyChain(lotId) {
  const lot = await prisma.traceabilityLot.findUnique({ where: { id: lotId } });
  if (!lot) throw Object.assign(new Error('Lot not found'), { status: 404 });

  const blocks = await prisma.traceabilityBlock.findMany({
    where: { lot_id: lotId },
    orderBy: { block_index: 'asc' },
  });

  const errors = [];
  let expectedPrevious = GENESIS_PREVIOUS_HASH;

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];

    if (b.block_index !== i) {
      errors.push({ blockIndex: i, code: 'INDEX_MISMATCH', message: `Expected index ${i}, found ${b.block_index}` });
    }

    if (b.previous_hash !== expectedPrevious) {
      errors.push({ blockIndex: i, code: 'BROKEN_LINK', message: `previous_hash does not match prior block_hash` });
    }

    const recomputedPayload = hashPayload(b.payload_json);
    if (recomputedPayload !== b.payload_hash) {
      errors.push({ blockIndex: i, code: 'PAYLOAD_TAMPERED', message: 'payload_json has been modified since block creation' });
    }

    const recomputedBlockHash = computeBlockHash({
      blockIndex: b.block_index,
      payloadHash: b.payload_hash,
      previousHash: b.previous_hash,
      timestamp: b.event_timestamp,
    });
    if (recomputedBlockHash !== b.block_hash) {
      errors.push({ blockIndex: i, code: 'HASH_MISMATCH', message: 'Block hash does not match canonical recomputation' });
    }

    if (!verifySignature(b.block_hash, b.signature)) {
      errors.push({ blockIndex: i, code: 'BAD_SIGNATURE', message: 'HMAC signature failed verification' });
    }

    expectedPrevious = b.block_hash;
  }

  if (blocks.length > 0 && lot.current_hash !== blocks[blocks.length - 1].block_hash) {
    errors.push({ blockIndex: blocks.length - 1, code: 'TIP_MISMATCH', message: 'Lot.current_hash does not match latest block' });
  }
  if (blocks.length > 0 && lot.genesis_hash !== blocks[0].block_hash) {
    errors.push({ blockIndex: 0, code: 'GENESIS_MISMATCH', message: 'Lot.genesis_hash does not match first block' });
  }

  return {
    valid: errors.length === 0,
    lot_id: lot.id,
    lot_code: lot.lot_code,
    block_count: blocks.length,
    genesis_hash: lot.genesis_hash,
    current_hash: lot.current_hash,
    errors,
  };
}

// ─── Public provenance lookup ──────────────────────────────────────

/**
 * Returns a buyer-safe view of a lot by its public lot_code.
 * Strips internal IDs, user references, and commercial fields that
 * shouldn't leak publicly. The returned chain still includes block
 * hashes so a buyer can independently verify the structure.
 */
export async function getPublicProvenance(lotCode) {
  const lot = await prisma.traceabilityLot.findFirst({
    where: { lot_code: lotCode },
    include: {
      blocks: { orderBy: { block_index: 'asc' } },
      origin_location: true,
    },
  });
  if (!lot) return null;

  return {
    lot_code: lot.lot_code,
    crop_year: lot.crop_year,
    crop_type: lot.crop_type,
    variety: lot.variety,
    grade: lot.grade,
    farm_site: lot.farm_site,
    origin_location: lot.origin_location?.name || null,
    total_bushels: lot.total_bushels,
    total_mt: lot.total_mt,
    status: lot.status,
    block_count: lot.block_count,
    genesis_hash: lot.genesis_hash,
    current_hash: lot.current_hash,
    created_at: lot.created_at,
    chain: lot.blocks.map((b) => ({
      block_index: b.block_index,
      event_type: b.event_type,
      event_timestamp: b.event_timestamp,
      farm_site: b.farm_site,
      crop_type: b.crop_type,
      variety: b.variety,
      grade: b.grade,
      protein_pct: b.protein_pct,
      moisture_pct: b.moisture_pct,
      bushels: b.bushels,
      net_weight_mt: b.net_weight_mt,
      destination: b.destination,
      payload_hash: b.payload_hash,
      previous_hash: b.previous_hash,
      block_hash: b.block_hash,
    })),
  };
}
