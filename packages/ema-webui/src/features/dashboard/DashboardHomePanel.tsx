"use client";

import styles from "@/app/dashboard/page.module.css";

import {
  APP_BRAND_BADGE,
  APP_BRAND_NAME,
  APP_RELEASE_VERSION,
} from "./layout-constants";

export function DashboardHomePanel() {
  return (
    <div className={styles.homePanel} aria-label="首页">
      <div className={styles.homeBrand}>
        <div className={styles.homeTitleLockup}>
          <h1 className={styles.homeTitle}>{APP_BRAND_NAME}</h1>
          <span className={styles.homeBetaBadge}>{APP_BRAND_BADGE}</span>
        </div>
      </div>
      <div className={styles.homeVersion}>版本：{APP_RELEASE_VERSION}</div>
    </div>
  );
}
