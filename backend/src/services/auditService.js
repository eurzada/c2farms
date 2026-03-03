import prisma from '../config/database.js';

/**
 * Log an audit trail entry. Failures are swallowed so auditing never breaks
 * the main operation.
 */
export async function logAudit({ farmId, userId, entityType, entityId, action, changes, metadata }) {
  try {
    await prisma.auditLog.create({
      data: {
        farm_id: farmId,
        user_id: userId,
        entity_type: entityType,
        entity_id: entityId,
        action,
        changes: changes ?? undefined,
        metadata: metadata ?? undefined,
      },
    });
  } catch (err) {
    console.error('Audit log failed:', err.message);
  }
}

/**
 * Compute a diff between old and new objects for the specified fields.
 * Returns { field: { old, new } } for each changed field, or null if nothing changed.
 */
export function diffChanges(oldObj, newObj, fields) {
  const diff = {};
  for (const field of fields) {
    const oldVal = oldObj[field] ?? null;
    const newVal = newObj[field] ?? null;
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      diff[field] = { old: oldVal, new: newVal };
    }
  }
  return Object.keys(diff).length > 0 ? diff : null;
}
