import { useCallback, useRef } from 'react';

/**
 * Persist ag-Grid column state (width, order, sort, visibility) to localStorage.
 *
 * Usage:
 *   const { onGridReady, onStateChanged } = useGridState('my_grid_key');
 *   <AgGridReact onGridReady={onGridReady} onColumnResized={onStateChanged}
 *     onColumnMoved={onStateChanged} onSortChanged={onStateChanged}
 *     onColumnVisible={onStateChanged} ... />
 */
export default function useGridState(storageKey) {
  const debounceTimer = useRef(null);

  const onGridReady = useCallback((params) => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        params.api.applyColumnState({ state: JSON.parse(saved), applyOrder: true });
      }
    } catch { /* ignore corrupt state */ }
  }, [storageKey]);

  const onStateChanged = useCallback((params) => {
    // Debounce — column resize fires many events during drag
    clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      try {
        const state = params.api.getColumnState();
        localStorage.setItem(storageKey, JSON.stringify(state));
      } catch { /* ignore */ }
    }, 300);
  }, [storageKey]);

  return { onGridReady, onStateChanged };
}
