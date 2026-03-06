export function extractErrorMessage(err, fallback = 'An unexpected error occurred') {
  return err?.response?.data?.error
    || err?.response?.data?.errors?.[0]
    || err?.message
    || fallback;
}
