"use client";

import { useState, type ReactNode } from "react";
import {
  Brain,
  CalendarDays,
  ChartColumn,
  FileClock,
  Settings,
} from "lucide-react";

import styles from "@/app/dashboard/page.module.css";
import type { ActorSummary } from "@/types/dashboard/v1beta1";

export type ActorSideTabId =
  | "schedule"
  | "memory"
  | "logs"
  | "stats"
  | "settings";

export function ActorSidePanel({
  actor,
  hidden = false,
  activeTab,
  defaultTab = "schedule",
  onActiveTabChange,
  renderSettings,
}: {
  actor: ActorSummary;
  hidden?: boolean;
  activeTab?: ActorSideTabId;
  defaultTab?: ActorSideTabId;
  onActiveTabChange?: (tab: ActorSideTabId) => void;
  renderSettings: () => ReactNode;
}) {
  const [internalActiveTab, setInternalActiveTab] =
    useState<ActorSideTabId>(defaultTab);
  const resolvedActiveTab = activeTab ?? internalActiveTab;
  const actorName = actor.name;
  const tabs: Array<{
    id: ActorSideTabId;
    label: string;
    icon: ActorSideTabId;
  }> = [
    { id: "schedule", label: "日程", icon: "schedule" },
    { id: "memory", label: "记忆", icon: "memory" },
    { id: "logs", label: "日志", icon: "logs" },
    { id: "stats", label: "统计", icon: "stats" },
    { id: "settings", label: "设置", icon: "settings" },
  ];
  const activeTabLabel =
    tabs.find((tab) => tab.id === resolvedActiveTab)?.label ?? "信息";

  function changeTab(tab: ActorSideTabId) {
    if (!activeTab) {
      setInternalActiveTab(tab);
    }
    onActiveTabChange?.(tab);
  }

  return (
    <section
      className={`${styles.actorInfoPanel} ${
        hidden ? styles.actorInfoPanelHidden : ""
      }`}
      aria-label={`${actorName} 信息`}
      aria-hidden={hidden}
    >
      <div
        className={styles.actorInfoTabs}
        role="tablist"
        aria-label="信息面板"
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={resolvedActiveTab === tab.id}
            className={`${styles.actorInfoTab} ${
              resolvedActiveTab === tab.id ? styles.actorInfoTabActive : ""
            }`}
            tabIndex={hidden ? -1 : undefined}
            onClick={() => changeTab(tab.id)}
          >
            <ActorSidePanelIcon name={tab.icon} />
            <span>{tab.label}</span>
          </button>
        ))}
      </div>
      <div
        className={styles.actorInfoBody}
        role="tabpanel"
        aria-label={activeTabLabel}
      >
        {resolvedActiveTab === "settings" ? (
          renderSettings()
        ) : (
          <div className={styles.actorInfoComingSoon}>
            <span>{activeTabLabel}</span>
            <strong>Coming soon</strong>
          </div>
        )}
      </div>
    </section>
  );
}

function ActorSidePanelIcon({ name }: { name: ActorSideTabId }) {
  if (name === "schedule") return <CalendarDays aria-hidden="true" />;
  if (name === "memory") return <Brain aria-hidden="true" />;
  if (name === "logs") return <FileClock aria-hidden="true" />;
  if (name === "stats") return <ChartColumn aria-hidden="true" />;
  return <Settings aria-hidden="true" />;
}
