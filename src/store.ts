import localforage from 'localforage';

export interface HistoryItem {
  id: string;
  garment: string;
  modelImage?: string;
  prompt?: string;
  resultUrl?: string;
  status: 'running' | 'succeeded' | 'failed' | 'queued';
  progress: number;
  error?: string;
  timestamp: number;
}

const store = localforage.createInstance({
  name: 'tryon-history'
});

export async function saveHistory(item: HistoryItem) {
  await store.setItem(item.id, item);
}

export async function getHistory(): Promise<HistoryItem[]> {
  const items: HistoryItem[] = [];
  await store.iterate((value: HistoryItem) => {
    items.push(value);
  });
  return items.sort((a, b) => b.timestamp - a.timestamp);
}

export async function deleteHistory(id: string) {
  await store.removeItem(id);
}