/**
 * Job data definitions and mappings.
 */

import type { JobHandlerMap } from "../base";
import { TestJobHandler, type TestJobData } from "./test.job";

/**
 * Mapping from job name to its data schema.
 */
export interface JobDataMap {
  /**
   * Demo job data mapping.
   */
  test: TestJobData;
}

/**
 * Mapping from job name to its handler implementation.
 */
export const jobHandlers = {
  test: TestJobHandler,
} satisfies JobHandlerMap;
