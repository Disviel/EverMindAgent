import "server-only";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createEmptyMockDb, type MockDb } from "@/server/store/schema";

const MOCK_DB_PATH = join(process.cwd(), ".cache", "mock-db.json");
const FLUSH_DELAY_MS = 500;

type StoreGlobal = {
  db: MockDb | null;
  loading: Promise<MockDb> | null;
  flushTimer: ReturnType<typeof setTimeout> | null;
  flushing: Promise<void> | null;
};

const globalStore = globalThis as typeof globalThis & {
  __emaWebuiMockStore?: StoreGlobal;
};

function getStoreGlobal(): StoreGlobal {
  globalStore.__emaWebuiMockStore ??= {
    db: null,
    loading: null,
    flushTimer: null,
    flushing: null,
  };
  return globalStore.__emaWebuiMockStore;
}

function cloneDb<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function loadDbFromDisk() {
  try {
    const text = await readFile(MOCK_DB_PATH, "utf8");
    return {
      ...createEmptyMockDb(),
      ...(JSON.parse(text) as Partial<MockDb>),
    };
  } catch {
    return createEmptyMockDb();
  }
}

export async function getDbSnapshot(): Promise<MockDb> {
  const store = getStoreGlobal();
  if (store.db) {
    return cloneDb(store.db);
  }

  store.loading ??= loadDbFromDisk().then((db) => {
    store.db = db;
    store.loading = null;
    return db;
  });

  return cloneDb(await store.loading);
}

async function flushNow() {
  const store = getStoreGlobal();
  if (!store.db) {
    return;
  }

  const payload = JSON.stringify(store.db, null, 2);
  await mkdir(dirname(MOCK_DB_PATH), { recursive: true });
  await writeFile(MOCK_DB_PATH, `${payload}\n`, "utf8");
}

function scheduleFlush() {
  const store = getStoreGlobal();
  if (store.flushTimer) {
    clearTimeout(store.flushTimer);
  }

  store.flushTimer = setTimeout(() => {
    store.flushTimer = null;
    store.flushing = flushNow().finally(() => {
      store.flushing = null;
    });
  }, FLUSH_DELAY_MS);
}

export async function updateDb<T>(mutator: (db: MockDb) => T): Promise<T> {
  const store = getStoreGlobal();
  if (!store.db) {
    store.db = await getDbSnapshot();
  }

  const result = mutator(store.db);
  store.db.updatedAt = new Date().toISOString();
  scheduleFlush();
  return result;
}

export async function flushDbForTests() {
  const store = getStoreGlobal();
  if (store.flushTimer) {
    clearTimeout(store.flushTimer);
    store.flushTimer = null;
  }
  await flushNow();
}
