import { File, Paths } from 'expo-file-system/next';
import api from './api';

export interface TicketOverrides {
  ticket_number?: string;
  delivery_date?: string;
  crop?: string;
  crop_year?: number;
  commodity_id?: string;
  location_id?: string;
  bin_id?: string;
  contract_number?: string;
  marketing_contract_id?: string;
  operator_name?: string;
  equipment?: string;
  destination?: string;
  buyer?: string;
  gross_weight_kg?: number;
  tare_weight_kg?: number;
  net_weight_kg?: number;
  moisture_pct?: number;
  grade?: string;
  dockage_pct?: number;
  protein_pct?: number;
  notes?: string;
}

export interface QueueItem {
  id: string;
  client_id: string;
  farm_id: string;
  image_uri: string;
  extraction_json: Record<string, unknown> | null;
  overrides: Record<string, unknown>;
  device_timestamp: string;
  status: 'pending' | 'syncing' | 'synced' | 'failed';
  retries: number;
  error: string | null;
  created_at: string;
}

const QUEUE_FILE = new File(Paths.document, 'sync_queue.json');
const MAX_RETRIES = 5;

async function readQueue(): Promise<QueueItem[]> {
  try {
    if (!QUEUE_FILE.exists) return [];
    const content = QUEUE_FILE.text();
    return JSON.parse(content);
  } catch {
    return [];
  }
}

async function writeQueue(queue: QueueItem[]): Promise<void> {
  QUEUE_FILE.write(JSON.stringify(queue));
}

/**
 * Add a ticket to the offline sync queue.
 */
export async function enqueue(item: Omit<QueueItem, 'status' | 'retries' | 'error' | 'created_at'>): Promise<void> {
  const queue = await readQueue();
  queue.push({
    ...item,
    status: 'pending',
    retries: 0,
    error: null,
    created_at: new Date().toISOString(),
  });
  await writeQueue(queue);
}

/**
 * Get all pending/failed items that haven't exceeded max retries.
 */
export async function getPendingItems(): Promise<QueueItem[]> {
  const queue = await readQueue();
  return queue.filter(
    (item) => (item.status === 'pending' || item.status === 'failed') && item.retries < MAX_RETRIES,
  );
}

/**
 * Get counts by status for display.
 */
export async function getQueueStats(): Promise<{ pending: number; syncing: number; synced: number; failed: number }> {
  const queue = await readQueue();
  return {
    pending: queue.filter((i) => i.status === 'pending').length,
    syncing: queue.filter((i) => i.status === 'syncing').length,
    synced: queue.filter((i) => i.status === 'synced').length,
    failed: queue.filter((i) => i.status === 'failed' && i.retries >= MAX_RETRIES).length,
  };
}

/**
 * Update the status of a queue item.
 */
async function updateItem(id: string, updates: Partial<QueueItem>): Promise<void> {
  const queue = await readQueue();
  const idx = queue.findIndex((item) => item.id === id);
  if (idx !== -1) {
    queue[idx] = { ...queue[idx], ...updates };
    await writeQueue(queue);
  }
}

/**
 * Sync a single queue item to the backend.
 */
async function syncItem(item: QueueItem): Promise<boolean> {
  await updateItem(item.id, { status: 'syncing' });

  try {
    const formData = new FormData();

    // Attach photo
    if (item.image_uri) {
      const filename = item.image_uri.split('/').pop() || 'ticket.jpg';
      formData.append('photo', {
        uri: item.image_uri,
        name: filename,
        type: 'image/jpeg',
      } as unknown as Blob);
    }

    // Attach ticket data
    formData.append('data', JSON.stringify({
      client_id: item.client_id,
      extraction_json: item.extraction_json,
      overrides: item.overrides,
      device_timestamp: item.device_timestamp,
    }));

    const response = await api.post(`/farms/${item.farm_id}/mobile/tickets`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60000, // longer timeout for photo upload
    });

    if (response.status === 201 || response.status === 409) {
      // 409 = duplicate client_id, already synced
      await updateItem(item.id, { status: 'synced', error: null });
      return true;
    }

    throw new Error(`Unexpected status: ${response.status}`);
  } catch (err: unknown) {
    const error = err as { response?: { status: number } };
    // 409 = duplicate, treat as success
    if (error.response?.status === 409) {
      await updateItem(item.id, { status: 'synced', error: null });
      return true;
    }

    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    await updateItem(item.id, {
      status: 'failed',
      retries: item.retries + 1,
      error: errorMsg,
    });
    return false;
  }
}

/**
 * Process all pending items in the queue.
 * Returns { synced, failed } counts.
 */
export async function syncAll(): Promise<{ synced: number; failed: number }> {
  const pending = await getPendingItems();
  let synced = 0;
  let failed = 0;

  for (const item of pending) {
    const success = await syncItem(item);
    if (success) synced++;
    else failed++;

    // Exponential backoff between items on failure
    if (!success) {
      const delay = Math.min(1000 * Math.pow(2, item.retries), 30000);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  return { synced, failed };
}

/**
 * Clean up synced items older than 7 days.
 */
export async function cleanSynced(): Promise<void> {
  const queue = await readQueue();
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const cleaned = queue.filter(
    (item) => item.status !== 'synced' || item.created_at > cutoff,
  );
  await writeQueue(cleaned);
}
