import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ObjectId } from "mongodb";

import { createMongo } from "../db";
import type { Mongo } from "../db";
import { AgendaScheduler, type JobHandlerMap } from "../scheduler";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("AgendaScheduler", () => {
  let mongo: Mongo;
  let scheduler: AgendaScheduler;

  beforeEach(async () => {
    mongo = await createMongo("", "ema_scheduler_test", "memory");
    await mongo.connect();
    scheduler = new AgendaScheduler(mongo, {
      processEvery: 20,
      defaultConcurrency: 1,
      maxConcurrency: 1,
      defaultLockLimit: 1,
      lockLimit: 1,
      defaultLockLifetime: 1000,
    });
  });

  afterEach(async () => {
    await scheduler.stop();
    await mongo.close();
  });

  test("throws when scheduling before start", async () => {
    await expect(
      scheduler.schedule({
        name: "test",
        runAt: Date.now() + 50,
        payload: { message: "not-started" },
      }),
    ).rejects.toThrow("Scheduler is not running.");
  });

  test("executes a scheduled job", async () => {
    let resolveDone!: () => void;
    const donePromise = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    let received: string | null = null;

    const handler = vi.fn(async (job) => {
      received = job.attrs.data?.message ?? null;
      resolveDone();
    });
    const handlers: JobHandlerMap = { test: handler };
    await scheduler.start(handlers);

    await scheduler.schedule({
      name: "test",
      runAt: Date.now(),
      payload: { message: "hello" },
    });

    await Promise.race([
      donePromise,
      sleep(5000).then(() => {
        throw new Error("timeout");
      }),
    ]);

    expect(received).toBe("hello");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test("cancels a pending job and removes it from the database", async () => {
    const handler = vi.fn(async () => {});
    const handlers: JobHandlerMap = { test: handler };
    await scheduler.start(handlers);

    const jobId = await scheduler.schedule({
      name: "test",
      runAt: Date.now() + 500,
      payload: { message: "cancel" },
    });

    const canceled = await scheduler.cancel(jobId);
    expect(canceled).toBe(true);

    await sleep(200);
    expect(handler).not.toHaveBeenCalled();

    const collection = mongo.getDb().collection(scheduler.collectionName);
    const doc = await collection.findOne({ _id: new ObjectId(jobId) });
    expect(doc).toBeNull();
  });

  test("reschedules a job and updates its data", async () => {
    let resolveDone!: () => void;
    const donePromise = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    let received: string | null = null;

    const handler = vi.fn(async (job) => {
      received = job.attrs.data.message;
      resolveDone();
    });
    const handlers: JobHandlerMap = { test: handler };
    await scheduler.start(handlers);

    const jobId = await scheduler.schedule({
      name: "test",
      runAt: Date.now() + 800,
      payload: { message: "old" },
    });

    const updated = await scheduler.reschedule(jobId, {
      name: "test",
      runAt: Date.now() + 50,
      payload: { message: "new" },
    });
    expect(updated).toBe(true);

    await Promise.race([
      donePromise,
      sleep(1000).then(() => {
        throw new Error("timeout");
      }),
    ]);

    expect(received).toBe("new");
  });

  test("returns false when rescheduling a missing job", async () => {
    const handlers: JobHandlerMap = { test: async () => {} };
    await scheduler.start(handlers);

    const updated = await scheduler.reschedule(new ObjectId().toString(), {
      name: "test",
      runAt: Date.now() + 50,
      payload: { message: "missing" },
    });
    expect(updated).toBe(false);
  });
});
