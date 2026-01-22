"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./page.module.css";

type CollectionInfo = {
  name: string;
  count: number;
};

type DebugResponse =
  | { collections: CollectionInfo[] }
  | { collection: string; docs: unknown[] }
  | { error: string };

type SortOrder = "desc" | "asc";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const pad2 = (value: number) => String(value).padStart(2, "0");

const normalizeTimestamp = (value: unknown): number | null => {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === "number") {
    return value < 1_000_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isNaN(parsed)) {
      return parsed < 1_000_000_000_000 ? parsed * 1000 : parsed;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.getTime();
  }
  return null;
};

const formatTimestamp = (value: unknown) => {
  const time = normalizeTimestamp(value);
  if (!time) {
    return "No time";
  }
  const date = new Date(time);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
    date.getDate(),
  )} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(
    date.getSeconds(),
  )}`;
};

const getCreatedAt = (doc: unknown) =>
  isRecord(doc) ? doc.createdAt ?? doc.createAt ?? null : null;

const docTitle = (doc: unknown, index: number) => {
  if (!isRecord(doc)) {
    return `Item ${index + 1}`;
  }
  const idValue = doc.id ?? doc._id;
  const label =
    idValue !== undefined ? `#${String(idValue)}` : `Doc ${index + 1}`;
  const message = doc.message;
  const kind =
    doc.kind ??
    doc.type ??
    (isRecord(message) ? message.kind : undefined);
  return kind ? `${label} · ${String(kind)}` : label;
};

const docPreview = (doc: unknown) => {
  if (!isRecord(doc)) {
    return String(doc);
  }
  const keys = Object.keys(doc);
  if (keys.length === 0) {
    return "Empty object";
  }
  const list = keys.slice(0, 5).join(", ");
  return keys.length > 5 ? `${list}, …` : list;
};

export default function DebugDbPage() {
  const [collections, setCollections] = useState<CollectionInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [docs, setDocs] = useState<unknown[]>([]);
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [limit, setLimit] = useState("200");
  const [status, setStatus] = useState<string | null>(null);
  const [loadingCollections, setLoadingCollections] = useState(false);
  const [loadingDocs, setLoadingDocs] = useState(false);

  const parsedLimit = useMemo(() => {
    const value = Number.parseInt(limit, 10);
    return Number.isNaN(value) ? null : value;
  }, [limit]);

  const sortedDocs = useMemo(() => {
    const withIndex = docs.map((doc, index) => ({
      doc,
      index,
      createdAt: normalizeTimestamp(getCreatedAt(doc)) ?? 0,
    }));
    withIndex.sort((a, b) => {
      if (a.createdAt === b.createdAt) {
        return a.index - b.index;
      }
      return sortOrder === "desc"
        ? b.createdAt - a.createdAt
        : a.createdAt - b.createdAt;
    });
    return withIndex.map((item) => item.doc);
  }, [docs, sortOrder]);

  const loadCollections = async () => {
    setLoadingCollections(true);
    setStatus(null);
    try {
      const response = await fetch("/api/debug/db");
      const payload = (await response.json()) as DebugResponse;
      if (!response.ok || "error" in payload) {
        setStatus("Failed to load collections.");
        return;
      }
      if ("collections" in payload) {
        setCollections(payload.collections);
        const names = payload.collections.map((item) => item.name);
        let nextSelected = selected;
        if (!nextSelected || !names.includes(nextSelected)) {
          nextSelected = names[0] ?? null;
          setSelected(nextSelected);
        }
        return nextSelected;
      }
    } catch (error) {
      console.error("Failed to load collections:", error);
      setStatus("Network error while loading collections.");
    } finally {
      setLoadingCollections(false);
    }
    return selected;
  };

  const loadDocs = async (collectionOverride?: string | null) => {
    const collection = collectionOverride ?? selected;
    if (!collection) {
      setDocs([]);
      setStatus("Select a collection to view its documents.");
      return;
    }
    if (parsedLimit === null || parsedLimit <= 0) {
      setStatus("Limit must be a positive number.");
      return;
    }
    setLoadingDocs(true);
    setStatus(null);
    try {
      const response = await fetch(
        `/api/debug/db?collection=${encodeURIComponent(
          collection,
        )}&limit=${parsedLimit}`,
      );
      const payload = (await response.json()) as DebugResponse;
      if (!response.ok || "error" in payload) {
        setStatus(
          "Failed to load documents. Check the collection name and limit.",
        );
        return;
      }
      if ("docs" in payload) {
        setDocs(payload.docs ?? []);
      }
    } catch (error) {
      console.error("Failed to load docs:", error);
      setStatus("Network error while loading documents.");
    } finally {
      setLoadingDocs(false);
    }
  };

  const refreshAll = async () => {
    const nextSelected = await loadCollections();
    await loadDocs(nextSelected ?? null);
  };

  useEffect(() => {
    void refreshAll();
  }, []);

  return (
    <div className={styles.page}>
      <div className={styles.hero}>
        <div>
          <span className={styles.badge}>Debug</span>
          <h1>Database Inspector</h1>
          <p>Browse collections and inspect in-memory documents quickly.</p>
        </div>
        <button
          className={styles.refreshButton}
          onClick={refreshAll}
          disabled={loadingCollections}
        >
          {loadingCollections ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <div className={styles.sidebarHeader}>
            <h2>Collections</h2>
            <span className={styles.counter}>{collections.length}</span>
          </div>
          <div className={styles.collectionList}>
            {collections.map((item) => (
              <button
                key={item.name}
                className={
                  selected === item.name
                    ? styles.collectionActive
                    : styles.collectionItem
                }
                onClick={() => {
                  setSelected(item.name);
                  void loadDocs(item.name);
                }}
              >
                <span className={styles.collectionName}>{item.name}</span>
                <span className={styles.collectionCount}>{item.count}</span>
              </button>
            ))}
          </div>
        </aside>

        <main className={styles.main}>
          <div className={styles.toolbar}>
            <div>
              <h2>{selected ?? "Select a collection"}</h2>
              <p className={styles.subtitle}>
                {selected
                  ? `Showing up to ${parsedLimit ?? "..."} documents`
                  : "Choose a collection from the left panel."}
              </p>
            </div>
            <div className={styles.toolbarActions}>
              <label className={styles.label}>
                Limit
                <input
                  className={styles.input}
                  value={limit}
                  onChange={(event) => setLimit(event.target.value)}
                />
              </label>
              <button
                type="button"
                className={styles.sortButton}
                onClick={() =>
                  setSortOrder((prev) => (prev === "desc" ? "asc" : "desc"))
                }
              >
                {sortOrder === "desc" ? "Newest" : "Oldest"}
              </button>
              <button
                className={styles.primaryButton}
                onClick={loadDocs}
                disabled={loadingDocs}
              >
                {loadingDocs ? "Loading..." : "Load"}
              </button>
            </div>
          </div>

          {status ? <div className={styles.status}>{status}</div> : null}

          <div className={styles.docsPanel}>
            {sortedDocs.length === 0 ? (
              <div className={styles.emptyState}>
                {selected
                  ? "No documents returned for this collection."
                  : "Pick a collection to inspect its documents."}
              </div>
            ) : (
              <div className={styles.docGrid}>
                {sortedDocs.map((doc, index) => (
                  <details key={index} className={styles.docCard}>
                    <summary className={styles.docSummary}>
                      <div>
                        <div className={styles.docTitle}>
                          {docTitle(doc, index)}
                        </div>
                        <div className={styles.docPreview}>
                          {docPreview(doc)}
                        </div>
                      </div>
                      <span className={styles.docBadge}>
                        {formatTimestamp(getCreatedAt(doc))}
                      </span>
                    </summary>
                    <pre className={styles.codeBlock}>
                      {JSON.stringify(doc, null, 2)}
                    </pre>
                  </details>
                ))}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
