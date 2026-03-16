import { useEffect, useRef } from 'react';
import { connectSocket } from '../services/socket';

/**
 * Subscribe to marketing real-time events for a farm.
 * Calls onEvent(eventName, data) when any marketing event fires.
 */
export function useMarketingSocket(farmId, onEvent) {
  const socketRef = useRef(null);
  const callbackRef = useRef(onEvent);
  callbackRef.current = onEvent;

  useEffect(() => {
    if (!farmId) return;

    const socket = connectSocket();
    socketRef.current = socket;

    socket.emit('join-farm-marketing', farmId);

    const events = [
      'marketing:contract:created',
      'marketing:contract:updated',
      'marketing:delivery:created',
      'marketing:price:updated',
      'settlement:approved',
      'settlement:created',
    ];

    const handlers = events.map(event => {
      const handler = (data) => callbackRef.current?.(event, data);
      socket.on(event, handler);
      return { event, handler };
    });

    return () => {
      for (const { event, handler } of handlers) {
        socket.off(event, handler);
      }
      socket.emit('leave-farm-marketing', farmId);
    };
  }, [farmId]);

  return socketRef;
}
