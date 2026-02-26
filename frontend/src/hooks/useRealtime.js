import { useEffect, useRef } from 'react';
import { connectSocket } from '../services/socket';

export function useRealtime(farmId, onCellChanged) {
  const socketRef = useRef(null);
  const callbackRef = useRef(onCellChanged);
  callbackRef.current = onCellChanged;

  useEffect(() => {
    if (!farmId) return;

    const socket = connectSocket();
    socketRef.current = socket;

    socket.emit('join-farm', farmId);

    const handler = (data) => {
      callbackRef.current?.(data);
    };
    socket.on('cell-changed', handler);

    return () => {
      socket.off('cell-changed', handler);
      socket.emit('leave-farm', farmId);
    };
  }, [farmId]);

  return socketRef;
}
