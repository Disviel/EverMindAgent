"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Plus } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import styles from "./page.module.css";

import { ChatPanel } from "@/features/chat/ChatPanel";
import {
  ActorSidePanel,
  type ActorSideTabId,
} from "@/features/actor-sidebar/ActorSidePanel";
import { ActorItem, type ActorLatestPreviewState } from "@/features/actor-sidebar/ActorItem";
import { ActorSettingsPanel } from "@/features/actor-settings/ActorSettingsPanel";
import { CreateActorOverlay } from "@/features/create-actor/components/CreateActorOverlay";
import { DashboardHomePanel } from "@/features/dashboard/DashboardHomePanel";
import { DashboardSkeleton } from "@/features/dashboard/DashboardSkeleton";
import {
  ACTOR_INFO_DEFAULT_WIDTH,
  ACTOR_INFO_MIN_WIDTH,
  CHAT_PANEL_MIN_WIDTH,
  LAYOUT_RESIZER_SIZE,
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_COLLAPSE_THRESHOLD,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_EXPANDED_MIN_WIDTH,
} from "@/features/dashboard/layout-constants";
import { getDashboardOverview } from "@/transport/dashboard";
import { subscribeEmaEvents } from "@/transport/events";
import type { EmaKnownEvent } from "@/types/events/v1beta1";
import type {
  ActorRuntimeStatus,
  DashboardOverviewResponse,
} from "@/types/dashboard/v1beta1";

type LayoutResizeTarget = "sidebar" | "actorInfo";

interface DashboardLayoutState {
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  chatPanelWidth: number;
  actorInfoWidth: number;
  actorInfoVisible: boolean;
}

const ACTOR_LATEST_PREVIEW_EXIT_DURATION = 260;
const DASHBOARD_LAYOUT_STORAGE_KEY = "ema-webui-dashboard-layout-v3";
const DASHBOARD_LAYOUT_RESET_KEY = "ema-webui-dashboard-layout-reset";
const DASHBOARD_LAYOUT_RESET_TOKEN = "equal-side-layout-v1";
const DASHBOARD_LAYOUT_STORAGE_KEYS = [
  "ema-webui-dashboard-layout",
  "ema-webui-dashboard-layout-v2",
  DASHBOARD_LAYOUT_STORAGE_KEY,
] as const;

const fallbackOverview: DashboardOverviewResponse = {
  apiVersion: "v1beta1",
  generatedAt: new Date(0).toISOString(),
  user: {
    id: "current-user",
    name: "你",
  },
  actors: [],
};

function userInitial(name: string) {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "U";
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function shouldKeepTextSelection(target: EventTarget | null) {
  return target instanceof Element
    ? Boolean(
        target.closest(
          'input, textarea, [contenteditable="true"], [data-text-selectable="true"], [data-message-context-menu="true"]',
        ),
      )
    : false;
}

function resetDashboardLayoutStorageIfNeeded() {
  if (typeof window === "undefined") {
    return;
  }

  if (
    window.localStorage.getItem(DASHBOARD_LAYOUT_RESET_KEY) ===
    DASHBOARD_LAYOUT_RESET_TOKEN
  ) {
    return;
  }

  DASHBOARD_LAYOUT_STORAGE_KEYS.forEach((key) => {
    window.localStorage.removeItem(key);
  });
  window.localStorage.setItem(
    DASHBOARD_LAYOUT_RESET_KEY,
    DASHBOARD_LAYOUT_RESET_TOKEN,
  );
}

function getDefaultDashboardLayout(): DashboardLayoutState {
  const contentWidth =
    typeof window === "undefined"
      ? 1400
      : Math.max(960, window.innerWidth - 32);
  const availableWidth = contentWidth - LAYOUT_RESIZER_SIZE * 2;
  const sidebarWidth = SIDEBAR_DEFAULT_WIDTH;
  const actorInfoWidth = ACTOR_INFO_DEFAULT_WIDTH;
  const chatPanelWidth = Math.max(
    CHAT_PANEL_MIN_WIDTH,
    availableWidth - sidebarWidth - actorInfoWidth,
  );

  return {
    sidebarWidth,
    sidebarCollapsed: false,
    chatPanelWidth,
    actorInfoWidth,
    actorInfoVisible: true,
  };
}

function getInitialDashboardLayout(): DashboardLayoutState {
  return {
    sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
    sidebarCollapsed: false,
    chatPanelWidth: CHAT_PANEL_MIN_WIDTH,
    actorInfoWidth: ACTOR_INFO_DEFAULT_WIDTH,
    actorInfoVisible: true,
  };
}

function getStoredDashboardLayout(): DashboardLayoutState {
  resetDashboardLayoutStorageIfNeeded();
  const fallbackLayout = getDefaultDashboardLayout();

  if (typeof window === "undefined") {
    return fallbackLayout;
  }

  try {
    const stored = window.localStorage.getItem(DASHBOARD_LAYOUT_STORAGE_KEY);
    if (!stored) {
      return fallbackLayout;
    }

    const parsed = JSON.parse(stored) as Partial<DashboardLayoutState>;
    return {
      sidebarWidth:
        typeof parsed.sidebarWidth === "number"
          ? parsed.sidebarWidth
          : fallbackLayout.sidebarWidth,
      sidebarCollapsed: Boolean(parsed.sidebarCollapsed),
      chatPanelWidth:
        typeof parsed.chatPanelWidth === "number"
          ? parsed.chatPanelWidth
          : fallbackLayout.chatPanelWidth,
      actorInfoWidth:
        typeof parsed.actorInfoWidth === "number"
          ? parsed.actorInfoWidth
          : fallbackLayout.actorInfoWidth,
      actorInfoVisible:
        typeof parsed.actorInfoVisible === "boolean"
          ? parsed.actorInfoVisible
          : fallbackLayout.actorInfoVisible,
    };
  } catch {
    return fallbackLayout;
  }
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardContent />
    </Suspense>
  );
}

function DashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const dashboardShellRef = useRef<HTMLElement>(null);
  const [overview, setOverview] =
    useState<DashboardOverviewResponse>(fallbackOverview);
  const [overviewLoaded, setOverviewLoaded] = useState(false);
  const actorLatestPreviewTimersRef = useRef<
    Map<string, ReturnType<typeof setTimeout>>
  >(new Map());
  const [actorUnreadById, setActorUnreadById] = useState<
    Record<string, number>
  >({});
  const [actorLatestById, setActorLatestById] = useState<
    Record<string, ActorLatestPreviewState>
  >({});
  const [createActorVisible, setCreateActorVisible] = useState(false);
  const [actorInfoActiveTab, setActorInfoActiveTab] =
    useState<ActorSideTabId>("schedule");
  const [startupTipActorId, setStartupTipActorId] = useState<string | null>(
    null,
  );
  const [layoutState, setLayoutState] = useState<DashboardLayoutState>(
    getInitialDashboardLayout,
  );
  const [layoutStorageReady, setLayoutStorageReady] = useState(false);
  const [resizingTarget, setResizingTarget] =
    useState<LayoutResizeTarget | null>(null);
  const {
    sidebarWidth,
    sidebarCollapsed,
    chatPanelWidth,
    actorInfoWidth,
    actorInfoVisible,
  } = layoutState;

  const requestedActorId = searchParams.get("actorId");
  const activeActorId = overview.actors.some(
    (actor) => actor.id === requestedActorId,
  )
    ? requestedActorId
    : null;
  const activeActor =
    overview.actors.find((actor) => actor.id === activeActorId) ?? null;
  const isCreateActorRouteActive = searchParams.get("createActor") === "1";
  const isCreateActorActive = createActorVisible || isCreateActorRouteActive;
  const isHomeActive = !requestedActorId && !isCreateActorActive;
  const showCreateActorTip =
    overviewLoaded && overview.actors.length === 0 && !isCreateActorActive;

  function closeCreateActorOverlay() {
    setCreateActorVisible(false);
    if (isCreateActorRouteActive) {
      router.push(
        activeActorId ? `/dashboard?actorId=${activeActorId}` : "/dashboard",
        {
          scroll: false,
        },
      );
    }
  }

  function applyOverview(result: DashboardOverviewResponse) {
    setOverview(result);
    setActorLatestById((current) => {
      const next = { ...current };
      result.actors.forEach((actor) => {
        if (!actor.latestPreview || next[actor.id]) {
          return;
        }
        next[actor.id] = {
          current: {
            ...actor.latestPreview,
            version: 1,
          },
        };
      });
      return next;
    });
  }

  const updateActorLatestPreview = useCallback(
    (actorId: string, text: string, time: number) => {
      const existingTimer = actorLatestPreviewTimersRef.current.get(actorId);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      let exitingVersion: number | null = null;
      setActorLatestById((current) => {
        const previous = current[actorId]?.current;
        const nextPreview = {
          text,
          time,
          version: (previous?.version ?? 0) + 1,
        };
        exitingVersion = previous?.version ?? null;

        return {
          ...current,
          [actorId]: {
            current: nextPreview,
            ...(previous ? { exiting: previous } : {}),
          },
        };
      });

      const timer = setTimeout(() => {
        setActorLatestById((current) => {
          const previewState = current[actorId];
          if (
            !previewState?.exiting ||
            previewState.exiting.version !== exitingVersion
          ) {
            return current;
          }

          return {
            ...current,
            [actorId]: {
              current: previewState.current,
            },
          };
        });
        actorLatestPreviewTimersRef.current.delete(actorId);
      }, ACTOR_LATEST_PREVIEW_EXIT_DURATION);

      actorLatestPreviewTimersRef.current.set(actorId, timer);
    },
    [],
  );

  const updateActorRuntimeStatus = useCallback(
    (actorId: string, status: ActorRuntimeStatus) => {
      setOverview((current) => ({
        ...current,
        actors: current.actors.map((actor) =>
          actor.id === actorId ? { ...actor, status } : actor,
        ),
      }));
    },
    [],
  );

  useEffect(() => {
    const storedLayout = getStoredDashboardLayout();
    setLayoutState(
      storedLayout.actorInfoVisible
        ? normalizeLayoutForViewport(storedLayout)
        : storedLayout,
    );
    setLayoutStorageReady(true);
    // The initial client-only layout intentionally reads localStorage after
    // hydration so the server and first client render keep identical style
    // attributes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!layoutStorageReady) {
      return;
    }

    window.localStorage.setItem(
      DASHBOARD_LAYOUT_STORAGE_KEY,
      JSON.stringify(layoutState),
    );
  }, [layoutState, layoutStorageReady]);

  useEffect(() => {
    const normalizeLayout = () => {
      setLayoutState((current) =>
        current.actorInfoVisible
          ? normalizeLayoutForViewport(current)
          : current,
      );
    };

    normalizeLayout();
    window.addEventListener("resize", normalizeLayout);

    return () => {
      window.removeEventListener("resize", normalizeLayout);
    };
    // normalizeLayoutForViewport intentionally reads the latest DOM width and
    // active panel state, while this effect only needs to rebind on visibility
    // and actor-level structure changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeActor]);

  useEffect(() => {
    const clearSelectionOnOutsidePointerDown = (event: PointerEvent) => {
      if (shouldKeepTextSelection(event.target)) {
        return;
      }

      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) {
        selection.removeAllRanges();
      }
    };

    document.addEventListener(
      "pointerdown",
      clearSelectionOnOutsidePointerDown,
      {
        capture: true,
      },
    );

    return () => {
      document.removeEventListener(
        "pointerdown",
        clearSelectionOnOutsidePointerDown,
        {
          capture: true,
        },
      );
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadOverview() {
      try {
        const result = await getDashboardOverview();
        if (cancelled) {
          return;
        }

        applyOverview(result);
      } catch {
        // 先保持本地架子可用，后续接真实后端时再补充全局错误处理。
      } finally {
        if (!cancelled) {
          setOverviewLoaded(true);
        }
      }
    }

    void loadOverview();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const actorLatestPreviewTimers = actorLatestPreviewTimersRef.current;

    return () => {
      actorLatestPreviewTimers.forEach((timer) => clearTimeout(timer));
      actorLatestPreviewTimers.clear();
    };
  }, []);

  useEffect(() => {
    const subscription = subscribeEmaEvents(null, (event: EmaKnownEvent) => {
      if (event.type === "actor.created") {
        setOverview((current) => {
          if (current.actors.some((actor) => actor.id === event.data.actor.id)) {
            return current;
          }
          return {
            ...current,
            actors: [...current.actors, event.data.actor],
          };
        });
        return;
      }

      if (event.type === "actor.updated") {
        setOverview((current) => ({
          ...current,
          actors: current.actors.map((actor) =>
            actor.id === event.data.actor.id ? event.data.actor : actor,
          ),
        }));
        return;
      }

      if (event.type === "actor.runtime.changed" && event.actorId) {
        updateActorRuntimeStatus(event.actorId, event.data.status);
        return;
      }

      if (event.type === "actor.latest_preview" && event.actorId) {
        updateActorLatestPreview(
          event.actorId,
          event.data.text,
          event.data.time,
        );
        if (event.actorId !== activeActorId) {
          setActorUnreadById((current) => ({
            ...current,
            [event.actorId!]: Math.min(999, (current[event.actorId!] ?? 0) + 1),
          }));
        }
      }
    });

    return () => subscription.close();
  }, [activeActorId, updateActorLatestPreview, updateActorRuntimeStatus]);

  function getDashboardContentWidth() {
    const shell = dashboardShellRef.current;
    if (!shell) {
      return window.innerWidth;
    }

    const style = window.getComputedStyle(shell);
    return (
      shell.clientWidth -
      Number.parseFloat(style.paddingLeft) -
      Number.parseFloat(style.paddingRight)
    );
  }

  function normalizeLayoutForViewport(layout: DashboardLayoutState) {
    const hasActorInfo = Boolean(activeActor && layout.actorInfoVisible);
    const contentWidth = getDashboardContentWidth();
    const resizerWidth =
      LAYOUT_RESIZER_SIZE + (hasActorInfo ? LAYOUT_RESIZER_SIZE : 0);
    const availablePanelWidth = Math.max(0, contentWidth - resizerWidth);
    const sidebarMinimum = layout.sidebarCollapsed
      ? SIDEBAR_COLLAPSED_WIDTH
      : SIDEBAR_EXPANDED_MIN_WIDTH;
    const actorInfoMinimum = hasActorInfo ? ACTOR_INFO_MIN_WIDTH : 0;
    const sidebarUpperBound = Math.max(
      sidebarMinimum,
      availablePanelWidth - CHAT_PANEL_MIN_WIDTH - actorInfoMinimum,
    );
    const sidebarPanelWidth = layout.sidebarCollapsed
      ? SIDEBAR_COLLAPSED_WIDTH
      : clamp(
          layout.sidebarWidth,
          SIDEBAR_EXPANDED_MIN_WIDTH,
          sidebarUpperBound,
        );
    const actorInfoPanelWidth = hasActorInfo
      ? clamp(
          layout.actorInfoWidth,
          ACTOR_INFO_MIN_WIDTH,
          Math.max(
            ACTOR_INFO_MIN_WIDTH,
            availablePanelWidth - sidebarPanelWidth - CHAT_PANEL_MIN_WIDTH,
          ),
        )
      : layout.actorInfoWidth;
    const chatPanelVisibleWidth = Math.max(
      CHAT_PANEL_MIN_WIDTH,
      availablePanelWidth -
        sidebarPanelWidth -
        (hasActorInfo ? actorInfoPanelWidth : 0),
    );

    return {
      ...layout,
      sidebarWidth: sidebarPanelWidth,
      actorInfoWidth: actorInfoPanelWidth,
      chatPanelWidth: chatPanelVisibleWidth,
    };
  }

  function resizeSidebarAndChat(
    requestedSidebarWidth: number,
    pairWidth: number,
  ) {
    setLayoutState((current) => {
      const canCollapse =
        pairWidth - SIDEBAR_COLLAPSED_WIDTH >= CHAT_PANEL_MIN_WIDTH;

      if (requestedSidebarWidth < SIDEBAR_COLLAPSE_THRESHOLD && canCollapse) {
        return {
          ...current,
          sidebarCollapsed: true,
          sidebarWidth: SIDEBAR_COLLAPSED_WIDTH,
          chatPanelWidth: pairWidth - SIDEBAR_COLLAPSED_WIDTH,
        };
      }

      const maxSidebarWidth = Math.max(
        SIDEBAR_EXPANDED_MIN_WIDTH,
        pairWidth - CHAT_PANEL_MIN_WIDTH,
      );
      const nextSidebarWidth = clamp(
        requestedSidebarWidth,
        SIDEBAR_EXPANDED_MIN_WIDTH,
        maxSidebarWidth,
      );

      return {
        ...current,
        sidebarCollapsed: false,
        sidebarWidth: nextSidebarWidth,
        chatPanelWidth: pairWidth - nextSidebarWidth,
      };
    });
  }

  function resizeActorInfoAndChat(
    requestedActorInfoWidth: number,
    pairWidth: number,
  ) {
    setLayoutState((current) => {
      const maxActorInfoWidth = Math.max(
        ACTOR_INFO_MIN_WIDTH,
        pairWidth - CHAT_PANEL_MIN_WIDTH,
      );
      const nextActorInfoWidth = clamp(
        requestedActorInfoWidth,
        ACTOR_INFO_MIN_WIDTH,
        maxActorInfoWidth,
      );

      return {
        ...current,
        chatPanelWidth: pairWidth - nextActorInfoWidth,
        actorInfoWidth: nextActorInfoWidth,
      };
    });
  }

  function startLayoutResize(
    target: LayoutResizeTarget,
    event: ReactPointerEvent<HTMLDivElement>,
  ) {
    event.preventDefault();
    const startX = event.clientX;
    const startSidebarWidth = sidebarCollapsed
      ? SIDEBAR_COLLAPSED_WIDTH
      : sidebarWidth;
    const startActorInfoWidth = actorInfoWidth;
    const sidebarChatPairWidth =
      getDashboardContentWidth() -
      LAYOUT_RESIZER_SIZE -
      (activeActor && actorInfoVisible
        ? LAYOUT_RESIZER_SIZE + startActorInfoWidth
        : 0);
    const actorInfoChatPairWidth =
      getDashboardContentWidth() - startSidebarWidth - LAYOUT_RESIZER_SIZE * 2;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    setResizingTarget(target);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const deltaX = moveEvent.clientX - startX;

      if (target === "sidebar") {
        resizeSidebarAndChat(startSidebarWidth + deltaX, sidebarChatPairWidth);
        return;
      }

      resizeActorInfoAndChat(
        startActorInfoWidth - deltaX,
        actorInfoChatPairWidth,
      );
    };

    const stopResize = () => {
      setResizingTarget(null);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", stopResize);
      document.removeEventListener("pointercancel", stopResize);
    };

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", stopResize);
    document.addEventListener("pointercancel", stopResize);
  }

  function handleLayoutResizeKeyDown(
    target: LayoutResizeTarget,
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) {
    const step = event.shiftKey ? 48 : 24;

    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }

    event.preventDefault();

    if (target === "sidebar") {
      const pairWidth =
        getDashboardContentWidth() -
        LAYOUT_RESIZER_SIZE -
        (activeActor && actorInfoVisible
          ? LAYOUT_RESIZER_SIZE + actorInfoWidth
          : 0);
      if (event.key === "ArrowLeft") {
        resizeSidebarAndChat(
          (sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : sidebarWidth) - step,
          pairWidth,
        );
        return;
      }

      resizeSidebarAndChat(
        sidebarCollapsed ? SIDEBAR_EXPANDED_MIN_WIDTH : sidebarWidth + step,
        pairWidth,
      );
      return;
    }

    if (!actorInfoVisible) {
      setLayoutState((current) =>
        normalizeLayoutForViewport({
          ...current,
          actorInfoVisible: true,
        }),
      );
      return;
    }

    resizeActorInfoAndChat(
      event.key === "ArrowLeft" ? actorInfoWidth + step : actorInfoWidth - step,
      getDashboardContentWidth() -
        (sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : sidebarWidth) -
        LAYOUT_RESIZER_SIZE * 2,
    );
  }

  const dashboardStyle = {
    "--sidebar-width": `${
      sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : sidebarWidth
    }px`,
  } as CSSProperties;
  const actorInfoPaneVisible = Boolean(activeActor && actorInfoVisible);
  const actorWorkspaceWidth =
    chatPanelWidth +
    (actorInfoPaneVisible ? LAYOUT_RESIZER_SIZE + actorInfoWidth : 0);
  const actorWorkspaceStyle = {
    "--chat-panel-width": `${chatPanelWidth}px`,
    "--actor-info-width": `${activeActor ? actorInfoWidth : 0}px`,
    "--actor-workspace-width": `${actorWorkspaceWidth}px`,
  } as CSSProperties;

  return (
    <main
      ref={dashboardShellRef}
      className={`${styles.dashboardShell} ${
        resizingTarget ? styles.dashboardShellResizing : ""
      }`}
      style={dashboardStyle}
    >
      <aside
        className={`${styles.sidebar} ${
          sidebarCollapsed ? styles.sidebarCollapsed : ""
        }`}
        aria-label="主导航"
      >
        <button
          type="button"
          className={`${styles.userButton} ${
            isHomeActive ? styles.userButtonActive : ""
          }`}
          title={overview.user.name}
          aria-current={isHomeActive ? "page" : undefined}
          onClick={() => router.push("/dashboard", { scroll: false })}
        >
          <span className={styles.userAvatar}>
            {userInitial(overview.user.name)}
          </span>
          <span className={styles.userName}>{overview.user.name}</span>
        </button>

        <div className={styles.sectionDivider} aria-hidden="true">
          <span>Actors</span>
        </div>

        <nav className={styles.actorList} aria-label="Actor 列表">
          {overview.actors.map((actor) => (
            <ActorItem
              key={actor.id}
              actor={actor}
              active={actor.id === activeActorId}
              latestPreview={actorLatestById[actor.id]}
              unreadCount={
                actor.id === activeActorId
                  ? 0
                  : (actorUnreadById[actor.id] ?? 0)
              }
              onSelect={() => {
                setActorUnreadById((current) => {
                  if (!current[actor.id]) {
                    return current;
                  }

                  return {
                    ...current,
                    [actor.id]: 0,
                  };
                });
                router.push(`/dashboard?actorId=${actor.id}`, {
                  scroll: false,
                });
              }}
            />
          ))}
          <div className={styles.createActorEntry}>
            <button
              type="button"
              className={`${styles.createActorButton} ${
                isCreateActorActive ? styles.createActorButtonActive : ""
              }`}
              title="创建角色"
              aria-current={isCreateActorActive ? "page" : undefined}
              onClick={() => setCreateActorVisible(true)}
            >
              <span className={styles.createActorIcon} aria-hidden="true">
                <Plus />
              </span>
              <span className={styles.actorCopy}>
                <span className={styles.actorName}>创建角色</span>
              </span>
            </button>
            {showCreateActorTip ? (
              <span className={styles.createActorBubbleTip} role="note">
                从这里创建第一个角色
              </span>
            ) : null}
          </div>
        </nav>
      </aside>

      <div
        className={`${styles.layoutResizer} ${
          resizingTarget === "sidebar" ? styles.layoutResizerActive : ""
        }`}
        role="separator"
        aria-orientation="vertical"
        aria-label="调整左侧导航宽度"
        tabIndex={0}
        onPointerDown={(event) => startLayoutResize("sidebar", event)}
        onKeyDown={(event) => handleLayoutResizeKeyDown("sidebar", event)}
      />

      <div
        className={`${styles.actorWorkspace} ${
          activeActor ? "" : styles.actorWorkspaceSingle
        } ${
          activeActor && !actorInfoVisible
            ? styles.actorWorkspaceSideHidden
            : ""
        }`}
        style={actorWorkspaceStyle}
      >
        <section className={styles.detailPanel} aria-label="详情面板">
          {activeActor ? (
            <ChatPanel
              key={activeActor.id}
              actor={activeActor}
              userName={overview.user.name}
              onActorLatestMessage={updateActorLatestPreview}
              actorInfoVisible={actorInfoVisible}
              onToggleActorInfo={() => {
                setLayoutState((current) => {
                  const nextLayout = {
                    ...current,
                    actorInfoVisible: !current.actorInfoVisible,
                  };

                  return nextLayout.actorInfoVisible
                    ? normalizeLayoutForViewport(nextLayout)
                    : nextLayout;
                });
              }}
            />
          ) : (
            <DashboardHomePanel />
          )}
        </section>
        {activeActor ? (
          <>
            <div
              className={`${styles.layoutResizer} ${
                resizingTarget === "actorInfo" ? styles.layoutResizerActive : ""
              } ${!actorInfoVisible ? styles.layoutResizerHidden : ""}`}
              role="separator"
              aria-orientation="vertical"
              aria-label="调整右侧卡片宽度"
              tabIndex={actorInfoVisible ? 0 : -1}
              onPointerDown={(event) => {
                if (actorInfoVisible) {
                  startLayoutResize("actorInfo", event);
                }
              }}
              onKeyDown={(event) =>
                handleLayoutResizeKeyDown("actorInfo", event)
              }
            />
            <ActorSidePanel
              actor={activeActor}
              hidden={!actorInfoVisible}
              activeTab={actorInfoActiveTab}
              onActiveTabChange={setActorInfoActiveTab}
              renderSettings={() => (
                <ActorSettingsPanel
                  actor={activeActor}
                  showStartupTip={
                    startupTipActorId === activeActor.id &&
                    activeActor.status === "offline"
                  }
                  onStartupTipDismiss={() => setStartupTipActorId(null)}
                  onActorStatusChange={updateActorRuntimeStatus}
                />
              )}
            />
          </>
        ) : null}
      </div>
      {isCreateActorActive ? (
        <CreateActorOverlay
          onClose={closeCreateActorOverlay}
          onCreated={(actor) => {
            setOverview((current) => {
              if (current.actors.some((item) => item.id === actor.id)) {
                return current;
              }
              return {
                ...current,
                actors: [...current.actors, actor],
              };
            });
            setActorInfoActiveTab("settings");
            setStartupTipActorId(actor.id);
            setLayoutState((current) => ({
              ...current,
              actorInfoVisible: true,
            }));
            closeCreateActorOverlay();
            router.push(`/dashboard?actorId=${actor.id}`, { scroll: false });
          }}
        />
      ) : null}
    </main>
  );
}
