/**
 * Emits structured data change events to AI-subscribed clients.
 * Events are sent to the `farm-ai:{farmId}` room.
 */
export function emitDataChange(io, farmId, event) {
  if (!io || !farmId) return;
  io.to(`farm-ai:${farmId}`).emit('ai:data-change', {
    farmId,
    timestamp: new Date().toISOString(),
    ...event,
  });
}

// Event builder helpers
export const aiEvents = {
  cellEdit: (type, month, categoryCode, oldValue, newValue) => ({
    type: 'cell_edit',
    detail: { gridType: type, month, categoryCode, oldValue, newValue },
  }),
  actualImport: (monthsImported, accountsImported) => ({
    type: 'actual_import',
    detail: { monthsImported, accountsImported },
  }),
  budgetFrozen: (fiscalYear) => ({
    type: 'budget_frozen',
    detail: { fiscalYear },
  }),
  budgetUnfrozen: (fiscalYear) => ({
    type: 'budget_unfrozen',
    detail: { fiscalYear },
  }),
  assumptionChanged: (field, oldValue, newValue) => ({
    type: 'assumption_changed',
    detail: { field, oldValue, newValue },
  }),
  glMappingChanged: (accountCount) => ({
    type: 'gl_mapping_changed',
    detail: { accountCount },
  }),
};
