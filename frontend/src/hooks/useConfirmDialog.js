import { useState, useCallback } from 'react';

export function useConfirmDialog() {
  const [state, setState] = useState({
    open: false,
    title: '',
    message: '',
    confirmText: 'Confirm',
    confirmColor: 'primary',
    resolve: null,
  });

  const confirm = useCallback(({ title, message, confirmText = 'Confirm', confirmColor = 'primary' }) => {
    return new Promise((resolve) => {
      setState({ open: true, title, message, confirmText, confirmColor, resolve });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    state.resolve?.(true);
    setState(s => ({ ...s, open: false }));
  }, [state]);

  const handleCancel = useCallback(() => {
    state.resolve?.(false);
    setState(s => ({ ...s, open: false }));
  }, [state]);

  const dialogProps = {
    open: state.open,
    title: state.title,
    message: state.message,
    confirmText: state.confirmText,
    confirmColor: state.confirmColor,
    onConfirm: handleConfirm,
    onCancel: handleCancel,
  };

  return { confirm, dialogProps };
}
