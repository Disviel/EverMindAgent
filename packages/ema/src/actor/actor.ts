import { Logger } from "../shared/logger";
import {
  EMA_MEMORY_ROLLUP_PROMPT,
  EMA_SLEEP_PROMPT,
  EMA_WAKE_PROMPT,
} from "../memory/prompts";
import { runActorBackgroundJob } from "../scheduler/jobs/actor.job";
import type { Server } from "../server";
import { formatTimestamp } from "../shared/utils";
import type { ChannelEvent } from "../channel";
import type {
  ActorChatInput,
  ActorInput,
  ActorStatus,
  ActorSystemInput,
} from "./base";
import { ActorWorker } from "./actor_worker";
import {
  SessionManager,
  type SessionManagerQueueEvent,
} from "./session_manager";
import { HeartbeatTimer } from "./timer";

const DEFAULT_SLEEP_QUIET_PERIOD_MS = 5 * 60_000;

export class Actor {
  readonly sessionManager: SessionManager;
  private readonly sleepTimer = new HeartbeatTimer(
    DEFAULT_SLEEP_QUIET_PERIOD_MS,
  );

  private currentConversationId: number | null = null;
  private currentWorker: ActorWorker | null = null;
  private acquiring = false;
  private bootInitPromise: Promise<void> | null = null;
  private status: ActorStatus = "sleep";
  private dayDate: string | null = null;
  private readonly logger: Logger;

  private constructor(
    readonly actorId: number,
    private readonly server: Server,
  ) {
    this.logger = Logger.create({
      name: "actor",
      context: {
        actorId,
      },
      outputs: [
        { type: "console", level: "info" },
        { type: "file", level: "debug" },
      ],
    });
    this.sessionManager = new SessionManager(
      this.handleQueueUnlocked.bind(this),
      {},
      this.handleQueueEvent.bind(this),
    );
    this.sleepTimer.on(() => {
      this.runDetached(this.handleSleepTimerFired(), "handle sleep timer");
    });
  }

  static async create(actorId: number, server: Server): Promise<Actor> {
    const actor = new Actor(actorId, server);
    actor.logger.info("Actor runtime created");
    return actor;
  }

  getStatus(): ActorStatus {
    return this.status;
  }

  getDayDate(): string | null {
    return this.dayDate;
  }

  isBusy(): boolean {
    return this.currentConversationId !== null || this.currentWorker !== null;
  }

  isPreparing(): boolean {
    return this.status === "switching" || this.bootInitPromise !== null;
  }

  canRunActiveTasks(): boolean {
    return this.status === "awake";
  }

  startBootInit(): Promise<void> {
    if (this.bootInitPromise) {
      return this.bootInitPromise;
    }
    this.logger.info("Actor boot initialization started");
    const task = this.runBootInit().finally(() => {
      if (this.bootInitPromise === task) {
        this.bootInitPromise = null;
      }
      this.publishRuntimeStatus("boot_init:complete");
    });
    this.bootInitPromise = task;
    this.runDetached(task, "run boot init");
    this.publishRuntimeStatus("boot_init:start");
    return task;
  }

  beginWake(): boolean {
    if (this.status !== "sleep") {
      return false;
    }
    this.stopSleepTimer();
    this.status = "switching";
    this.logger.info("Actor waking");
    this.publishRuntimeStatus("wake:start");
    return true;
  }

  completeWake(): void {
    this.dayDate = formatTimestamp("YYYY-MM-DD", Date.now());
    this.status = "awake";
    this.logger.info("Actor awake", { dayDate: this.dayDate });
    this.publishRuntimeStatus("wake:complete");
    this.tryAcquireConversation();
  }

  failWake(): void {
    this.status = "sleep";
    this.logger.warn("Actor wake failed");
    this.publishRuntimeStatus("wake:failed");
  }

  startSleepTimer(): boolean {
    if (this.status !== "awake") {
      return false;
    }
    this.sleepTimer.start();
    return true;
  }

  resetSleepTimer(): boolean {
    if (this.status !== "awake" || !this.sleepTimer.isRunning()) {
      return false;
    }
    this.sleepTimer.reset();
    return true;
  }

  stopSleepTimer(): void {
    this.sleepTimer.stop();
  }

  beginSleep(): boolean {
    if (this.status !== "awake") {
      return false;
    }
    this.status = "switching";
    this.logger.info("Actor sleeping");
    this.publishRuntimeStatus("sleep:start");
    return true;
  }

  completeSleep(): void {
    this.stopSleepTimer();
    this.dayDate = null;
    this.status = "sleep";
    this.logger.info("Actor asleep");
    this.publishRuntimeStatus("sleep:complete");
  }

  failSleep(): void {
    this.status = "awake";
    this.logger.warn("Actor sleep failed");
    this.publishRuntimeStatus("sleep:failed");
    this.tryAcquireConversation();
  }

  enqueueChannelEvent(
    message: ChannelEvent,
    conversationId: number,
    msgId?: number,
  ): Promise<void> {
    let envelope: ActorInput;
    if (message.kind === "chat") {
      if (typeof msgId !== "number") {
        throw new Error("msgId is required for channel chat messages.");
      }
      envelope = {
        kind: "chat",
        conversationId,
        msgId,
        inputs: message.inputs,
        time: message.time,
        speaker: message.speaker,
        channelMessageId: message.channelMessageId,
        ...(message.replyTo ? { replyTo: message.replyTo } : {}),
      } satisfies ActorChatInput;
    } else {
      envelope = {
        kind: "system",
        conversationId,
        inputs: message.inputs,
        time: message.time,
      } satisfies ActorSystemInput;
    }
    return this.enqueueActorInput(conversationId, envelope);
  }

  async enqueueActorInput(
    conversationId: number,
    input: ActorInput,
  ): Promise<void> {
    if (input.kind === "chat") {
      await this.server.memoryManager.persistChatMessage(input);
    }
    this.sessionManager.enqueue(conversationId, input);
    this.logger.debug("Actor input enqueued", {
      conversationId,
      kind: input.kind,
    });
    this.resetSleepTimer();
    if (this.status !== "awake") {
      return;
    }
    if (this.currentConversationId === null) {
      this.tryAcquireConversation();
      return;
    }
    if (this.currentConversationId === conversationId) {
      this.pumpHeldQueue();
    }
  }

  private async runBootInit(): Promise<void> {
    try {
      await runActorBackgroundJob(
        this.server,
        {
          actorId: this.actorId,
          task: "memory_rollup",
          prompt: EMA_MEMORY_ROLLUP_PROMPT,
          addition: { reason: "flush" },
        },
        Date.now(),
      );
    } catch (error) {
      this.logger.error("Failed to run boot-init memory rollup:", error);
    }

    const listed = await this.server.getActorScheduler(this.actorId).list();
    const wakeSchedule = listed.recurring.find((item) => item.task === "wake");
    const sleepSchedule = listed.recurring.find(
      (item) => item.task === "sleep",
    );
    const shouldWake =
      !wakeSchedule ||
      !sleepSchedule ||
      (typeof wakeSchedule.lastRunAt === "string" &&
      typeof sleepSchedule.lastRunAt === "string"
        ? wakeSchedule.lastRunAt > sleepSchedule.lastRunAt
        : typeof wakeSchedule.lastRunAt === "string"
          ? true
          : typeof sleepSchedule.lastRunAt === "string"
            ? false
            : typeof wakeSchedule.nextRunAt === "string" &&
                typeof sleepSchedule.nextRunAt === "string"
              ? wakeSchedule.nextRunAt >= sleepSchedule.nextRunAt
              : true);
    if (!shouldWake) {
      return;
    }

    try {
      await runActorBackgroundJob(
        this.server,
        {
          actorId: this.actorId,
          task: "wake",
          prompt: EMA_WAKE_PROMPT,
        },
        Date.now(),
      );
    } catch (error) {
      this.logger.error("Failed to run boot-init wake task:", error);
    }
  }

  private async handleSleepTimerFired(): Promise<void> {
    if (this.status !== "awake") {
      return;
    }
    await runActorBackgroundJob(
      this.server,
      {
        actorId: this.actorId,
        task: "sleep",
        prompt: EMA_SLEEP_PROMPT,
        addition: { source: "timer" },
      },
      Date.now(),
    );
  }

  private tryAcquireConversation(): void {
    if (
      this.status !== "awake" ||
      this.currentConversationId !== null ||
      this.acquiring
    ) {
      return;
    }
    const conversationId = this.sessionManager.pickNextConversationId();
    if (conversationId === null) {
      return;
    }
    this.acquiring = true;
    this.runDetached(
      this.holdConversation(conversationId).finally(() => {
        this.acquiring = false;
        if (this.currentConversationId === null && this.status === "awake") {
          setTimeout(() => {
            this.tryAcquireConversation();
          }, 0);
        }
      }),
      `hold conversation ${conversationId}`,
    );
  }

  private async holdConversation(conversationId: number): Promise<void> {
    const worker = await ActorWorker.create(
      this.actorId,
      conversationId,
      this.server,
    );
    this.currentConversationId = conversationId;
    this.currentWorker = worker;
    this.logger.info("Conversation acquired", {
      conversationId,
      session: worker.session,
    });
    this.publishRuntimeStatus("conversation:acquired");
    worker.events.on("actorResponsed", (event) => {
      this.runDetached(
        this.server.gateway.dispatchActorResponse(event.response),
        `send reply for conversation ${conversationId}`,
      );
    });
    worker.events.on("workFinished", (event) => {
      if (!event.ok) {
        this.logger.error(
          `Worker finished with error for conversation ${conversationId}: ${event.msg}`,
          event.error,
        );
      }
      if (this.currentConversationId === conversationId) {
        this.releaseConversation();
        this.tryAcquireConversation();
      }
    });
    this.pumpHeldQueue();
  }

  private pumpHeldQueue(): void {
    if (
      this.status !== "awake" ||
      this.currentConversationId === null ||
      !this.currentWorker
    ) {
      return;
    }
    const conversationId = this.currentConversationId;
    for (;;) {
      const input = this.sessionManager.tryPop(conversationId);
      if (!input) {
        return;
      }
      this.runDetached(
        this.currentWorker.work(input),
        `dispatch held conversation ${conversationId}`,
      );
    }
  }

  private handleQueueUnlocked(conversationId: number): void {
    if (this.status !== "awake") {
      return;
    }
    if (this.currentConversationId === null) {
      this.tryAcquireConversation();
      return;
    }
    if (this.currentConversationId === conversationId) {
      this.pumpHeldQueue();
    }
  }

  private handleQueueEvent(
    conversationId: number,
    event: SessionManagerQueueEvent,
  ): void {
    switch (event.type) {
      case "rate_limited":
        this.logger.info("Session queue rate limited", {
          conversationId,
          queueSize: event.queueSize,
          dispatchesInWindow: event.dispatchesInWindow,
          maxDispatchesPerWindow: event.maxDispatchesPerWindow,
          rateLimitWindowMs: event.rateLimitWindowMs,
          unlockAt: event.unlockAt,
          delayMs: event.delayMs,
        });
        return;
      case "unlocked":
        this.logger.info("Session queue unlocked", {
          conversationId,
          queueSize: event.queueSize,
        });
        return;
      case "dropped":
        this.logger.warn("Session queue dropped oldest input", {
          conversationId,
          queueSize: event.queueSize,
          maxQueueSize: event.maxQueueSize,
        });
        return;
    }
  }

  private releaseConversation(): void {
    const conversationId = this.currentConversationId;
    const session = this.currentWorker?.session;
    if (this.currentWorker) {
      this.currentWorker.events.removeAllListeners("actorResponsed");
      this.currentWorker.events.removeAllListeners("workFinished");
    }
    this.currentWorker = null;
    this.currentConversationId = null;
    if (conversationId !== null) {
      this.logger.info("Conversation released", {
        conversationId,
        ...(session ? { session } : {}),
      });
    }
    this.publishRuntimeStatus("conversation:released");
  }

  private runDetached(task: Promise<unknown>, label: string): void {
    task.catch((error) => {
      this.logger.error(`Failed to ${label}:`, error);
    });
  }

  async dispose(): Promise<void> {
    this.stopSleepTimer();
    this.bootInitPromise = null;
    this.sessionManager.clear();
    this.releaseConversation();
    this.status = "sleep";
    this.dayDate = null;
    this.logger.info("Actor runtime disposed");
  }

  private publishRuntimeStatus(reason: string): void {
    this.server.controller.runtime.publishStatus(this.actorId, reason).catch(
      (error) => {
        this.logger.warn("Failed to publish runtime status", {
          reason,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    );
  }
}
