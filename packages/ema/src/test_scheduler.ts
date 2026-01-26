import { createMongo } from "./db";
import { AgendaScheduler, type JobHandlerMap } from "./scheduler";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const mongo = await createMongo("", "ema_scheduler_demo", "memory");
  await mongo.connect();

  const scheduler = new AgendaScheduler(mongo, {
    processEvery: 100,
    defaultConcurrency: 1,
    maxConcurrency: 1,
    defaultLockLimit: 1,
    lockLimit: 1,
    defaultLockLifetime: 10000,
  });

  const handlers: JobHandlerMap = {
    test: async (job) => {
      console.log(`[scheduler:test] ${job.attrs.data.message}`);
    },
  };

  try {
    await scheduler.start(handlers);

    const jobId = await scheduler.schedule({
      name: "test",
      runAt: Date.now() + 500,
      payload: { message: "hello from test_scheduler" },
    });

    console.log(`[scheduler] scheduled job ${jobId}`);

    await sleep(2000);
  } finally {
    await scheduler.stop();
    await mongo.close();
  }
}

main().catch((error) => {
  console.error("[scheduler] failed:", error);
  process.exitCode = 1;
});
