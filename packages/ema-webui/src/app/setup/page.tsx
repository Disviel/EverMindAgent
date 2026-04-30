"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Check, LoaderCircle, Moon, Sun, X } from "lucide-react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";

import {
  embeddingDefaults,
  initialDraft,
  isEmbeddingComplete,
  isLLMComplete,
  isStepComplete,
  llmDefaults,
  setupSteps,
  type SetupDraft,
  type SetupServiceCheckResponse,
  type SetupStepId,
} from "@/types/setup/v1beta1";
import { commitSetup, runSetupCheck, runSetupDryRun } from "@/transport/setup";
import {
  checkFeedbackFromResponse,
  dryRunFailureFeedback,
  localFeedback,
  transportFailureFeedback,
  type CheckFeedback,
} from "@/types/setup/feedback";
import {
  fieldLimits,
  getStepFieldPaths,
  getStepValidationErrors,
  validateSetupField,
  type SetupFieldPath,
} from "@/types/setup/form-validation";

type ThemeMode = "dark" | "light";
type StepMotion = "forward" | "backward";
type TestStatus = "idle" | "testing" | "success" | "failed";
type FinalCheckStatus =
  | "idle"
  | "mongo"
  | "llm"
  | "embedding"
  | "finalize"
  | "success"
  | "failed";
type FinalReviewStepId = Exclude<
  FinalCheckStatus,
  "idle" | "success" | "failed"
>;
type FinalFailedStepId = FinalReviewStepId;

interface TestState {
  status: TestStatus;
  feedback: CheckFeedback | null;
}

const finalReviewSteps: Array<{
  id: FinalReviewStepId;
  title: string;
}> = [
  { id: "mongo", title: "MongoDB" },
  { id: "llm", title: "LLM" },
  { id: "embedding", title: "Embedding" },
  { id: "finalize", title: "生成配置" },
];

const finalStepOrder: Record<FinalReviewStepId, number> = {
  mongo: 0,
  llm: 1,
  embedding: 2,
  finalize: 3,
};

function trimTerminalPunctuation(value: string | null) {
  return value?.replace(/[。.!！?？]+$/u, "") ?? null;
}

function testStateFromCheck(response: SetupServiceCheckResponse): TestState {
  return {
    status: response.ok ? "success" : "failed",
    feedback: checkFeedbackFromResponse(response),
  };
}

function Field({
  label,
  hint,
  error,
  optional = false,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>
        {label}
        <span
          className={optional ? styles.optionalMarker : styles.requiredMarker}
        >
          {optional ? "可选" : "必填"}
        </span>
      </span>
      {children}
      {hint ? <span className={styles.fieldHint}>{hint}</span> : null}
      {error ? (
        <span className={styles.fieldError} role="alert">
          {error}
        </span>
      ) : null}
    </label>
  );
}

function StatusIndicator({
  status,
  message,
}: {
  status: Exclude<TestStatus, "idle">;
  message: string | null;
}) {
  return (
    <span
      className={`${styles.connectionStatus} ${
        status === "testing"
          ? styles.statusTesting
          : status === "success"
            ? styles.statusSuccess
            : styles.statusFailed
      }`}
      role="status"
      aria-live="polite"
      aria-label={status === "testing" ? "正在测试" : (message ?? "测试失败")}
      title={status === "testing" ? "正在测试" : (message ?? "测试失败")}
    >
      <LoaderCircle className={styles.spinnerIcon} aria-hidden="true" />
      <Check className={styles.checkIcon} aria-hidden="true" />
      <X className={styles.failedIcon} aria-hidden="true" />
    </span>
  );
}

function InlineStatus({
  status,
  feedback,
  testingText,
}: {
  status: Exclude<TestStatus, "idle">;
  feedback: CheckFeedback | null;
  testingText: string;
}) {
  const statusText =
    status === "testing"
      ? testingText
      : (feedback?.summary ?? (status === "success" ? "检查通过" : "检查失败"));

  return (
    <span
      className={`${styles.inlineStatus} ${
        status === "testing"
          ? styles.inlineStatusTesting
          : status === "success"
            ? styles.inlineStatusSuccess
            : styles.inlineStatusFailed
      } ${styles.inlineStatusIconOnly}`}
    >
      <StatusIndicator status={status} message={statusText} />
    </span>
  );
}

function CheckFeedbackDetails({
  feedback,
}: {
  feedback: CheckFeedback | null;
}) {
  if (
    !feedback ||
    (!feedback.detail &&
      !feedback.technicalDetail &&
      !feedback.code &&
      feedback.meta.length === 0)
  ) {
    return null;
  }

  return (
    <div className={styles.errorDetails} role="alert">
      <div className={styles.errorDetailsHeader}>
        <span>错误</span>
        {feedback.code ? <code>{feedback.code}</code> : null}
      </div>
      {feedback.detail ? (
        <p className={styles.errorDetailText}>{feedback.detail}</p>
      ) : null}
      {feedback.technicalDetail ? (
        <div className={styles.errorTechnicalCard}>
          {feedback.technicalDetail}
        </div>
      ) : null}
      {feedback.meta.length > 0 ? (
        <dl className={styles.errorMeta}>
          {feedback.meta.map((item) => (
            <div key={`${item.label}:${item.value}`}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

export default function SetupPage() {
  const router = useRouter();
  const [themeMode, setThemeMode] = useState<ThemeMode>("dark");
  const [currentStep, setCurrentStep] = useState(0);
  const [stepMotion, setStepMotion] = useState<StepMotion>("forward");
  const [draft, setDraft] = useState<SetupDraft>(initialDraft);
  const [touchedFields, setTouchedFields] = useState<
    Partial<Record<SetupFieldPath, boolean>>
  >({});
  const mongoTestRun = useRef(0);
  const llmTestRun = useRef(0);
  const embeddingTestRun = useRef(0);
  const [mongoTest, setMongoTest] = useState<TestState>({
    status: "idle",
    feedback: null,
  });
  const [llmTest, setLlmTest] = useState<TestState>({
    status: "idle",
    feedback: null,
  });
  const [embeddingTest, setEmbeddingTest] = useState<TestState>({
    status: "idle",
    feedback: null,
  });
  const [finalCheck, setFinalCheck] = useState<FinalCheckStatus>("idle");
  const [finalFailedStep, setFinalFailedStep] =
    useState<FinalFailedStepId | null>(null);
  const [finalFeedback, setFinalFeedback] = useState<CheckFeedback | null>(
    null,
  );
  const [finalAttempt, setFinalAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const step = setupSteps[currentStep];
  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === setupSteps.length - 1;
  const isFinalTesting =
    finalCheck === "mongo" ||
    finalCheck === "llm" ||
    finalCheck === "embedding" ||
    finalCheck === "finalize";
  const currentStepComplete = isStepComplete(step.id, draft);
  const currentStepErrors = getStepValidationErrors(step.id, draft);
  const currentStepValid = currentStepErrors.length === 0;
  const finalProgress =
    finalCheck === "success"
      ? "75%"
      : finalCheck === "failed"
        ? finalFailedStep === "finalize"
          ? "75%"
          : finalFailedStep === "embedding"
            ? "50%"
            : finalFailedStep === "llm"
              ? "25%"
              : "0%"
        : finalCheck === "embedding"
          ? "50%"
          : finalCheck === "llm"
            ? "25%"
            : finalCheck === "finalize"
              ? "75%"
              : finalCheck === "mongo"
                ? "6%"
                : "0%";
  const finalTrackStyle = {
    "--final-progress": finalProgress,
    "--final-line-background":
      finalCheck === "success" || finalCheck === "failed"
        ? "var(--success)"
        : finalCheck === "finalize"
          ? "linear-gradient(90deg, var(--success) 0 66%, var(--accent) 66% 100%)"
          : finalCheck === "embedding"
            ? "linear-gradient(90deg, var(--success) 0 50%, var(--accent) 50% 100%)"
            : "var(--accent)",
    "--final-line-shadow":
      finalCheck === "success" || finalCheck === "failed"
        ? "color-mix(in srgb, var(--success) 20%, transparent)"
        : "color-mix(in srgb, var(--accent) 20%, transparent)",
  } as CSSProperties;
  const getFinalStepState = (
    id: (typeof finalReviewSteps)[number]["id"],
  ): "pending" | "testing" | "done" | "failed" => {
    if (finalCheck === "failed") {
      if (id === finalFailedStep) {
        return "failed";
      }
      if (
        finalFailedStep &&
        finalStepOrder[id] < finalStepOrder[finalFailedStep]
      ) {
        return "done";
      }
      return "pending";
    }
    if (finalCheck === "success") {
      return "done";
    }
    if (finalCheck === id) {
      return "testing";
    }
    if (
      finalCheck !== "idle" &&
      finalStepOrder[id] < finalStepOrder[finalCheck]
    ) {
      return "done";
    }
    return "pending";
  };
  const primaryDisabled =
    busy ||
    !currentStepComplete ||
    !currentStepValid ||
    (step.id === "mongo" && mongoTest.status !== "success") ||
    (step.id === "llm" && llmTest.status !== "success") ||
    (step.id === "embedding" && embeddingTest.status !== "success") ||
    (step.id === "review" &&
      finalCheck !== "success" &&
      finalCheck !== "failed");
  const actionHint = getActionHint();
  const displayActionHint = trimTerminalPunctuation(actionHint);

  useEffect(() => {
    const stored = window.localStorage.getItem(
      "ema-webui-theme",
    ) as ThemeMode | null;
    if (stored === "dark" || stored === "light") {
      setThemeMode(stored);
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    window.localStorage.setItem("ema-webui-theme", themeMode);
  }, [themeMode]);

  useEffect(() => {
    if (
      setupSteps[currentStep].id !== "review" ||
      !isStepComplete("review", draft)
    ) {
      return;
    }

    let cancelled = false;

    const runFinalCheck = async () => {
      setBusy(true);
      setFinalFailedStep(null);
      setFinalFeedback(null);
      setNotice(null);

      try {
        for (const target of ["mongo", "llm", "embedding"] as const) {
          setFinalCheck(target);
          const response = await runSetupCheck(
            target,
            draft[target],
            "final",
            finalAttempt,
          );
          if (cancelled) {
            return;
          }
          if (!response.ok) {
            setFinalFailedStep(target);
            setFinalFeedback(checkFeedbackFromResponse(response));
            setFinalCheck("failed");
            return;
          }
        }

        setFinalCheck("finalize");
        const result = await runSetupDryRun(draft);
        if (!result.ok) {
          setFinalFailedStep("finalize");
          setFinalFeedback(dryRunFailureFeedback(result));
          setFinalCheck("failed");
          return;
        }
        if (cancelled) {
          return;
        }

        setFinalFailedStep(null);
        setFinalCheck("success");
      } catch (error) {
        if (!cancelled) {
          setFinalCheck("failed");
          setFinalFeedback(transportFailureFeedback(error));
        }
      } finally {
        if (!cancelled) {
          setBusy(false);
        }
      }
    };

    void runFinalCheck();

    return () => {
      cancelled = true;
    };
  }, [currentStep, draft, finalAttempt]);

  function touchField(path: SetupFieldPath) {
    setTouchedFields((current) => ({ ...current, [path]: true }));
  }

  function touchStepFields(stepId: SetupStepId = step.id) {
    const paths = getStepFieldPaths(stepId, draft);
    if (paths.length === 0) {
      return;
    }
    setTouchedFields((current) => {
      const next = { ...current };
      for (const path of paths) {
        next[path] = true;
      }
      return next;
    });
  }

  function getVisibleFieldError(path: SetupFieldPath) {
    return touchedFields[path] ? validateSetupField(path, draft) : null;
  }

  function getFieldControlProps(path: SetupFieldPath) {
    const error = getVisibleFieldError(path);
    return {
      maxLength: fieldLimits[path],
      onBlur: () => touchField(path),
      "aria-invalid": error ? true : undefined,
    };
  }

  function getActionHint() {
    if (busy || isFinalTesting) {
      return "正在检查配置…";
    }

    if (currentStepErrors[0]) {
      return currentStepErrors[0].error;
    }

    if (!currentStepComplete) {
      if (step.id === "llm") {
        return "当前 LLM 供应商或模式暂未开放。";
      }
      return "请先完成当前步骤的必填项。";
    }

    if (step.id === "mongo" && mongoTest.status !== "success") {
      return mongoTest.status === "failed"
        ? "请处理错误后重新测试连接。"
        : "请先测试 MongoDB 连接。";
    }
    if (step.id === "llm" && llmTest.status !== "success") {
      return llmTest.status === "failed"
        ? "请处理错误后重新测试服务。"
        : "请先测试 LLM 服务。";
    }
    if (step.id === "embedding" && embeddingTest.status !== "success") {
      return embeddingTest.status === "failed"
        ? "请处理错误后重新测试服务。"
        : "请先测试 Embedding 服务。";
    }
    if (
      step.id === "review" &&
      finalCheck !== "success" &&
      finalCheck !== "failed"
    ) {
      return "正在检查配置…";
    }

    return null;
  }

  const resetMongoTest = () => {
    mongoTestRun.current += 1;
    setMongoTest({ status: "idle", feedback: null });
  };

  const resetLlmTest = () => {
    llmTestRun.current += 1;
    setLlmTest({ status: "idle", feedback: null });
  };

  const resetEmbeddingTest = () => {
    embeddingTestRun.current += 1;
    setEmbeddingTest({ status: "idle", feedback: null });
  };

  const updateMongo = (value: Partial<SetupDraft["mongo"]>) => {
    setDraft((current) => ({
      ...current,
      mongo: { ...current.mongo, ...value },
    }));
    setFinalCheck("idle");
    setFinalFailedStep(null);
    setFinalFeedback(null);
    resetMongoTest();
  };

  const updateLlm = (value: Partial<SetupDraft["llm"]>) => {
    setDraft((current) => ({
      ...current,
      llm: { ...current.llm, ...value },
    }));
    setFinalCheck("idle");
    setFinalFailedStep(null);
    setFinalFeedback(null);
    resetLlmTest();
  };

  const updateEmbedding = (value: Partial<SetupDraft["embedding"]>) => {
    setDraft((current) => ({
      ...current,
      embedding: { ...current.embedding, ...value },
    }));
    setFinalCheck("idle");
    setFinalFailedStep(null);
    setFinalFeedback(null);
    resetEmbeddingTest();
  };

  const updateOwner = (value: Partial<SetupDraft["owner"]>) => {
    setDraft((current) => ({
      ...current,
      owner: { ...current.owner, ...value },
    }));
    setFinalCheck("idle");
    setFinalFailedStep(null);
    setFinalFeedback(null);
  };

  const testMongoConnection = async () => {
    const errors = getStepValidationErrors("mongo", draft);
    if (errors[0]) {
      touchStepFields("mongo");
      setMongoTest({
        status: "failed",
        feedback: localFeedback("配置项还不完整", errors[0].error),
      });
      return;
    }

    const runId = ++mongoTestRun.current;
    setMongoTest({ status: "testing", feedback: null });
    try {
      const response = await runSetupCheck("mongo", draft.mongo, "step", runId);
      if (runId !== mongoTestRun.current) {
        return;
      }
      setMongoTest(testStateFromCheck(response));
    } catch (error) {
      if (runId !== mongoTestRun.current) {
        return;
      }
      setMongoTest({
        status: "failed",
        feedback: transportFailureFeedback(error),
      });
    }
  };

  const testLlmService = async () => {
    if (
      draft.llm.provider === "anthropic" ||
      (draft.llm.provider === "openai" && draft.llm.mode !== "responses")
    ) {
      setLlmTest({
        status: "failed",
        feedback: localFeedback(
          "当前模式暂不可用",
          "涉及字段：LLM 供应商",
          "UNSUPPORTED",
        ),
      });
      return;
    }

    const errors = getStepValidationErrors("llm", draft);
    if (errors[0]) {
      touchStepFields("llm");
      setLlmTest({
        status: "failed",
        feedback: localFeedback("配置项还不完整", errors[0].error),
      });
      return;
    }

    const runId = ++llmTestRun.current;
    setLlmTest({ status: "testing", feedback: null });
    try {
      const response = await runSetupCheck("llm", draft.llm, "step", runId);
      if (runId !== llmTestRun.current) {
        return;
      }
      setLlmTest(testStateFromCheck(response));
    } catch (error) {
      if (runId !== llmTestRun.current) {
        return;
      }
      setLlmTest({
        status: "failed",
        feedback: transportFailureFeedback(error),
      });
    }
  };

  const testEmbeddingService = async () => {
    const errors = getStepValidationErrors("embedding", draft);
    if (errors[0]) {
      touchStepFields("embedding");
      setEmbeddingTest({
        status: "failed",
        feedback: localFeedback("配置项还不完整", errors[0].error),
      });
      return;
    }

    const runId = ++embeddingTestRun.current;
    setEmbeddingTest({ status: "testing", feedback: null });
    try {
      const response = await runSetupCheck(
        "embedding",
        draft.embedding,
        "step",
        runId,
      );
      if (runId !== embeddingTestRun.current) {
        return;
      }
      setEmbeddingTest(testStateFromCheck(response));
    } catch (error) {
      if (runId !== embeddingTestRun.current) {
        return;
      }
      setEmbeddingTest({
        status: "failed",
        feedback: transportFailureFeedback(error),
      });
    }
  };

  const goNext = async () => {
    if (!currentStepComplete || currentStepErrors.length > 0) {
      touchStepFields();
      setNotice(currentStepErrors[0]?.error ?? "请先完成必填项。");
      return;
    }
    if (step.id === "mongo" && mongoTest.status !== "success") {
      setNotice("请先测试 MongoDB 连接。");
      return;
    }
    if (step.id === "llm" && llmTest.status !== "success") {
      setNotice("请先测试 LLM 服务。");
      return;
    }
    if (step.id === "embedding" && embeddingTest.status !== "success") {
      setNotice("请先测试 Embedding 服务。");
      return;
    }

    if (!isLastStep) {
      setStepMotion("forward");
      setCurrentStep((value) => Math.min(value + 1, setupSteps.length - 1));
      if (step.id === "mongo") {
        resetMongoTest();
      }
      if (step.id === "llm") {
        resetLlmTest();
      }
      if (step.id === "embedding") {
        resetEmbeddingTest();
      }
      setFinalCheck("idle");
      setFinalFailedStep(null);
      setFinalFeedback(null);
      setNotice(null);
      return;
    }

    if (finalCheck === "failed") {
      setFinalAttempt((value) => value + 1);
      setFinalFeedback(null);
      setNotice(null);
      return;
    }

    if (finalCheck === "success") {
      setBusy(true);
      setNotice(null);
      try {
        const result = await commitSetup(draft);
        if (!result.ok) {
          setFinalCheck("failed");
          setFinalFailedStep("finalize");
          setFinalFeedback(
            localFeedback("写入配置失败", "请稍后重试。", "COMMIT_FAILED"),
          );
          return;
        }
        router.push("/dashboard");
      } catch (error) {
        setFinalCheck("failed");
        setFinalFailedStep("finalize");
        setFinalFeedback(transportFailureFeedback(error));
      } finally {
        setBusy(false);
      }
      return;
    }

    setNotice(null);
  };

  const goBack = () => {
    if (isFinalTesting) {
      return;
    }

    setStepMotion("backward");
    setCurrentStep((value) => Math.max(value - 1, 0));
    if (step.id === "mongo") {
      resetMongoTest();
    }
    if (step.id === "llm") {
      resetLlmTest();
    }
    if (step.id === "embedding") {
      resetEmbeddingTest();
    }
    setFinalCheck("idle");
    setFinalFailedStep(null);
    setFinalFeedback(null);
    setNotice(null);
  };

  return (
    <main className={styles.shell}>
      <div className={styles.ambient} />
      <header className={styles.topbar}>
        <div>
          <span className={styles.eyebrow}>EMA WebUI</span>
          <h1>初始化配置</h1>
        </div>
        <button
          type="button"
          className={styles.themeButton}
          aria-label={
            themeMode === "dark" ? "切换到亮色模式" : "切换到暗色模式"
          }
          title={themeMode === "dark" ? "切换到亮色模式" : "切换到暗色模式"}
          onClick={() =>
            setThemeMode((mode) => (mode === "dark" ? "light" : "dark"))
          }
        >
          {themeMode === "dark" ? (
            <Sun aria-hidden="true" />
          ) : (
            <Moon aria-hidden="true" />
          )}
        </button>
      </header>

      <section className={styles.setupFrame}>
        <aside className={styles.stepRail} aria-label="初始化步骤">
          <ol className={styles.stepList}>
            {setupSteps.map((item, index) => {
              const state =
                index < currentStep
                  ? "done"
                  : index === currentStep
                    ? "current"
                    : "queued";
              return (
                <li
                  key={item.id}
                  className={`${styles.stepItem} ${styles[state]}`}
                  aria-current={index === currentStep ? "step" : undefined}
                >
                  <span className={styles.stepDot} />
                  <span className={styles.stepText}>
                    <strong>{item.title}</strong>
                    <small>{item.description}</small>
                  </span>
                </li>
              );
            })}
          </ol>
        </aside>

        <section className={styles.contentPanel}>
          <div
            key={step.id}
            className={`${styles.stepStage} ${styles[stepMotion]}`}
          >
            <div className={styles.stepHeader}>
              <span>{String(currentStep + 1).padStart(2, "0")}</span>
              <div>
                <h2>{step.title}</h2>
                <p>{step.description}</p>
              </div>
            </div>

            {notice && step.id !== "review" ? (
              <div className={styles.notice}>{notice}</div>
            ) : null}

            <div className={styles.contentBody}>{renderStepContent()}</div>
          </div>

          <footer className={styles.actions}>
            <button
              type="button"
              className={styles.textButton}
              onClick={() => {
                setDraft(initialDraft);
                resetMongoTest();
                resetLlmTest();
                resetEmbeddingTest();
                setTouchedFields({});
                setFinalCheck("idle");
                setFinalFailedStep(null);
                setFinalFeedback(null);
                setFinalAttempt(0);
                setStepMotion("backward");
                setCurrentStep(0);
                setNotice(null);
              }}
              disabled={isFinalTesting}
            >
              重置
            </button>
            <div className={styles.actionHintSlot} aria-live="polite">
              {primaryDisabled && displayActionHint ? (
                <span className={styles.actionHint}>{displayActionHint}</span>
              ) : null}
            </div>
            <div className={styles.actionGroup}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={goBack}
                disabled={isFirstStep || isFinalTesting}
              >
                上一步
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => void goNext()}
                disabled={primaryDisabled}
                title={displayActionHint ?? undefined}
              >
                {busy
                  ? "检查中"
                  : isLastStep && finalCheck === "failed"
                    ? "重新检查"
                    : isLastStep
                      ? "开始使用"
                      : "下一步"}
              </button>
            </div>
          </footer>
        </section>
      </section>
    </main>
  );

  function renderStepContent() {
    switch (step.id) {
      case "mongo":
        return (
          <div className={styles.stack}>
            <div
              className={styles.segmentedControl}
              role="tablist"
              aria-label="MongoDB 连接模式"
            >
              <button
                type="button"
                role="tab"
                aria-selected={draft.mongo.kind === "remote"}
                className={`${styles.segmentedTab} ${
                  draft.mongo.kind === "remote" ? styles.segmentedActive : ""
                }`}
                onClick={() => updateMongo({ kind: "remote" })}
              >
                MongoDB 服务
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={draft.mongo.kind === "memory"}
                className={`${styles.segmentedTab} ${
                  draft.mongo.kind === "memory" ? styles.segmentedActive : ""
                }`}
                onClick={() => updateMongo({ kind: "memory" })}
              >
                内存模式
              </button>
            </div>
            <div className={styles.formGrid}>
              {draft.mongo.kind === "remote" ? (
                <Field
                  label="连接地址"
                  error={getVisibleFieldError("mongo.uri")}
                >
                  <input
                    value={draft.mongo.uri}
                    required
                    aria-required="true"
                    {...getFieldControlProps("mongo.uri")}
                    onChange={(event) =>
                      updateMongo({ uri: event.target.value })
                    }
                  />
                </Field>
              ) : null}
              <Field
                label="数据库名"
                error={getVisibleFieldError("mongo.dbName")}
              >
                <input
                  value={draft.mongo.dbName}
                  required
                  aria-required="true"
                  {...getFieldControlProps("mongo.dbName")}
                  onChange={(event) =>
                    updateMongo({ dbName: event.target.value })
                  }
                />
              </Field>
            </div>
            <div className={styles.testRow}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => void testMongoConnection()}
                disabled={
                  mongoTest.status === "testing" ||
                  getStepValidationErrors("mongo", draft).length > 0
                }
                title={
                  getStepValidationErrors("mongo", draft).length > 0
                    ? "请先完成 MongoDB 必填项"
                    : undefined
                }
              >
                测试连接
              </button>
              {mongoTest.status !== "idle" ? (
                <InlineStatus
                  status={mongoTest.status}
                  feedback={mongoTest.feedback}
                  testingText="正在测试 MongoDB…"
                />
              ) : null}
            </div>
            {mongoTest.status === "failed" ? (
              <CheckFeedbackDetails feedback={mongoTest.feedback} />
            ) : null}
          </div>
        );
      case "llm": {
        const llmComingSoon =
          draft.llm.provider === "anthropic" ||
          (draft.llm.provider === "openai" && draft.llm.mode !== "responses");

        return (
          <div className={styles.stack}>
            <div
              className={`${styles.segmentedControl} ${styles.segmentedTriple}`}
              role="tablist"
              aria-label="LLM 服务供应商"
            >
              <button
                type="button"
                role="tab"
                aria-selected={draft.llm.provider === "google"}
                className={`${styles.segmentedTab} ${
                  draft.llm.provider === "google" ? styles.segmentedActive : ""
                }`}
                onClick={() => updateLlm(llmDefaults.google)}
              >
                Google
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={draft.llm.provider === "openai"}
                className={`${styles.segmentedTab} ${
                  draft.llm.provider === "openai" ? styles.segmentedActive : ""
                }`}
                onClick={() => updateLlm(llmDefaults.openai)}
              >
                OpenAI
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={draft.llm.provider === "anthropic"}
                className={`${styles.segmentedTab} ${
                  draft.llm.provider === "anthropic"
                    ? styles.segmentedActive
                    : ""
                }`}
                onClick={() => updateLlm(llmDefaults.anthropic)}
              >
                Anthropic
              </button>
            </div>
            {draft.llm.provider === "google" ? (
              <label className={styles.switchRow}>
                <span>
                  <strong>使用 Vertex AI</strong>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={draft.llm.useVertexAi}
                  onChange={(event) =>
                    updateLlm({ useVertexAi: event.target.checked })
                  }
                />
                <span className={styles.switchTrack} aria-hidden="true">
                  <span className={styles.switchThumb} />
                </span>
              </label>
            ) : draft.llm.provider === "openai" ? (
              <label className={styles.switchRow}>
                <span>
                  <strong>使用 Responses API</strong>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={draft.llm.mode === "responses"}
                  onChange={(event) =>
                    updateLlm({
                      mode: event.target.checked ? "responses" : "chat",
                    })
                  }
                />
                <span className={styles.switchTrack} aria-hidden="true">
                  <span className={styles.switchThumb} />
                </span>
              </label>
            ) : null}
            {llmComingSoon ? (
              <div className={styles.comingSoonPanel}>
                <span>coming soon</span>
              </div>
            ) : (
              <>
                <div className={styles.formGrid}>
                  <Field
                    label="模型名称"
                    error={getVisibleFieldError("llm.model")}
                  >
                    <input
                      value={draft.llm.model}
                      required
                      aria-required="true"
                      {...getFieldControlProps("llm.model")}
                      onChange={(event) =>
                        updateLlm({ model: event.target.value })
                      }
                    />
                  </Field>
                  {draft.llm.provider === "google" && draft.llm.useVertexAi ? (
                    <>
                      <Field
                        label="项目环境变量名"
                        error={getVisibleFieldError("llm.projectEnvKey")}
                      >
                        <input
                          value={draft.llm.projectEnvKey}
                          required
                          aria-required="true"
                          {...getFieldControlProps("llm.projectEnvKey")}
                          onChange={(event) =>
                            updateLlm({ projectEnvKey: event.target.value })
                          }
                        />
                      </Field>
                      <Field
                        label="区域环境变量名"
                        error={getVisibleFieldError("llm.locationEnvKey")}
                      >
                        <input
                          value={draft.llm.locationEnvKey}
                          required
                          aria-required="true"
                          {...getFieldControlProps("llm.locationEnvKey")}
                          onChange={(event) =>
                            updateLlm({ locationEnvKey: event.target.value })
                          }
                        />
                      </Field>
                    </>
                  ) : (
                    <>
                      <Field
                        label="Base URL"
                        error={getVisibleFieldError("llm.baseUrl")}
                      >
                        <input
                          value={draft.llm.baseUrl}
                          required
                          aria-required="true"
                          {...getFieldControlProps("llm.baseUrl")}
                          onChange={(event) =>
                            updateLlm({ baseUrl: event.target.value })
                          }
                        />
                      </Field>
                      <Field
                        label="环境变量名"
                        hint="这里只填写变量名，不直接填写密钥。"
                        error={getVisibleFieldError("llm.envKey")}
                      >
                        <input
                          value={draft.llm.envKey}
                          required
                          aria-required="true"
                          {...getFieldControlProps("llm.envKey")}
                          onChange={(event) =>
                            updateLlm({ envKey: event.target.value })
                          }
                        />
                      </Field>
                    </>
                  )}
                </div>
                <div className={styles.testRow}>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => void testLlmService()}
                    disabled={
                      llmTest.status === "testing" ||
                      getStepValidationErrors("llm", draft).length > 0 ||
                      !isLLMComplete(draft)
                    }
                    title={
                      getStepValidationErrors("llm", draft).length > 0 ||
                      !isLLMComplete(draft)
                        ? "请先完成 LLM 服务必填项"
                        : undefined
                    }
                  >
                    测试服务
                  </button>
                  {llmTest.status !== "idle" ? (
                    <InlineStatus
                      status={llmTest.status}
                      feedback={llmTest.feedback}
                      testingText="正在测试 LLM 服务…"
                    />
                  ) : null}
                </div>
                {llmTest.status === "failed" ? (
                  <CheckFeedbackDetails feedback={llmTest.feedback} />
                ) : null}
              </>
            )}
          </div>
        );
      }
      case "embedding":
        return (
          <div className={styles.stack}>
            <div
              className={styles.segmentedControl}
              role="tablist"
              aria-label="Embedding 服务供应商"
            >
              <button
                type="button"
                role="tab"
                aria-selected={draft.embedding.provider === "google"}
                className={`${styles.segmentedTab} ${
                  draft.embedding.provider === "google"
                    ? styles.segmentedActive
                    : ""
                }`}
                onClick={() => updateEmbedding(embeddingDefaults.google)}
              >
                Google
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={draft.embedding.provider === "openai"}
                className={`${styles.segmentedTab} ${
                  draft.embedding.provider === "openai"
                    ? styles.segmentedActive
                    : ""
                }`}
                onClick={() => updateEmbedding(embeddingDefaults.openai)}
              >
                OpenAI
              </button>
            </div>
            {draft.embedding.provider === "google" ? (
              <label className={styles.switchRow}>
                <span>
                  <strong>使用 Vertex AI</strong>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={draft.embedding.useVertexAi}
                  onChange={(event) =>
                    updateEmbedding({ useVertexAi: event.target.checked })
                  }
                />
                <span className={styles.switchTrack} aria-hidden="true">
                  <span className={styles.switchThumb} />
                </span>
              </label>
            ) : null}
            <div className={styles.formGrid}>
              <Field
                label="模型名称"
                error={getVisibleFieldError("embedding.model")}
              >
                <input
                  value={draft.embedding.model}
                  required
                  aria-required="true"
                  {...getFieldControlProps("embedding.model")}
                  onChange={(event) =>
                    updateEmbedding({ model: event.target.value })
                  }
                />
              </Field>
              {draft.embedding.provider === "google" &&
              draft.embedding.useVertexAi ? (
                <>
                  <Field
                    label="项目环境变量名"
                    error={getVisibleFieldError("embedding.projectEnvKey")}
                  >
                    <input
                      value={draft.embedding.projectEnvKey}
                      required
                      aria-required="true"
                      {...getFieldControlProps("embedding.projectEnvKey")}
                      onChange={(event) =>
                        updateEmbedding({ projectEnvKey: event.target.value })
                      }
                    />
                  </Field>
                  <Field
                    label="区域环境变量名"
                    error={getVisibleFieldError("embedding.locationEnvKey")}
                  >
                    <input
                      value={draft.embedding.locationEnvKey}
                      required
                      aria-required="true"
                      {...getFieldControlProps("embedding.locationEnvKey")}
                      onChange={(event) =>
                        updateEmbedding({ locationEnvKey: event.target.value })
                      }
                    />
                  </Field>
                </>
              ) : (
                <>
                  <Field
                    label="Base URL"
                    error={getVisibleFieldError("embedding.baseUrl")}
                  >
                    <input
                      value={draft.embedding.baseUrl}
                      required
                      aria-required="true"
                      {...getFieldControlProps("embedding.baseUrl")}
                      onChange={(event) =>
                        updateEmbedding({ baseUrl: event.target.value })
                      }
                    />
                  </Field>
                  <Field
                    label="环境变量名"
                    hint="这里只填写变量名，不直接填写密钥。"
                    error={getVisibleFieldError("embedding.envKey")}
                  >
                    <input
                      value={draft.embedding.envKey}
                      required
                      aria-required="true"
                      {...getFieldControlProps("embedding.envKey")}
                      onChange={(event) =>
                        updateEmbedding({ envKey: event.target.value })
                      }
                    />
                  </Field>
                </>
              )}
            </div>
            <div className={styles.testRow}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => void testEmbeddingService()}
                disabled={
                  embeddingTest.status === "testing" ||
                  getStepValidationErrors("embedding", draft).length > 0 ||
                  !isEmbeddingComplete(draft)
                }
                title={
                  getStepValidationErrors("embedding", draft).length > 0 ||
                  !isEmbeddingComplete(draft)
                    ? "请先完成 Embedding 必填项"
                    : undefined
                }
              >
                测试服务
              </button>
              {embeddingTest.status !== "idle" ? (
                <InlineStatus
                  status={embeddingTest.status}
                  feedback={embeddingTest.feedback}
                  testingText="正在测试 Embedding 服务…"
                />
              ) : null}
            </div>
            {embeddingTest.status === "failed" ? (
              <CheckFeedbackDetails feedback={embeddingTest.feedback} />
            ) : null}
          </div>
        );
      case "owner":
        return (
          <div className={styles.formGrid}>
            <Field label="名称" error={getVisibleFieldError("owner.name")}>
              <input
                value={draft.owner.name}
                required
                aria-required="true"
                {...getFieldControlProps("owner.name")}
                onChange={(event) => updateOwner({ name: event.target.value })}
              />
            </Field>
            <Field
              label="邮箱"
              optional
              error={getVisibleFieldError("owner.email")}
            >
              <input
                type="email"
                value={draft.owner.email}
                {...getFieldControlProps("owner.email")}
                onChange={(event) => updateOwner({ email: event.target.value })}
              />
            </Field>
            <Field
              label="QQ 号"
              optional
              hint="让EMA在QQ平台也能记得你"
              error={getVisibleFieldError("owner.qq")}
            >
              <input
                value={draft.owner.qq}
                inputMode="numeric"
                {...getFieldControlProps("owner.qq")}
                onChange={(event) =>
                  updateOwner({ qq: event.target.value.replace(/\D/g, "") })
                }
              />
            </Field>
          </div>
        );
      case "review":
        return (
          <div className={styles.finalReview}>
            <div className={styles.finalCheckPanel}>
              <div
                className={styles.finalTrack}
                style={finalTrackStyle}
                role="list"
                aria-label="最终检查进度"
              >
                {finalReviewSteps.map((item) => {
                  const state = getFinalStepState(item.id);
                  return (
                    <div
                      key={item.id}
                      className={`${styles.finalStep} ${
                        state === "testing"
                          ? styles.finalStepTesting
                          : state === "done"
                            ? styles.finalStepDone
                            : state === "failed"
                              ? styles.finalStepFailed
                              : ""
                      }`}
                      role="listitem"
                    >
                      <span className={styles.finalNode}>
                        {state === "pending" ? (
                          <span className={styles.finalPendingDot} />
                        ) : (
                          <span
                            className={styles.finalCheckGlyph}
                            aria-hidden="true"
                          >
                            {state === "testing" ? (
                              <LoaderCircle />
                            ) : state === "done" ? (
                              <Check />
                            ) : (
                              <X />
                            )}
                          </span>
                        )}
                      </span>
                      <span>{item.title}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {finalCheck === "failed" && finalFeedback ? (
              <div className={styles.finalIssueStack}>
                <CheckFeedbackDetails feedback={finalFeedback} />
              </div>
            ) : null}

            {finalCheck === "success" ? (
              <div className={styles.welcomeMessage} role="status">
                <strong>
                  <span className={styles.welcomePrefix}>欢迎，</span>
                  <span className={styles.welcomeName}>
                    {draft.owner.name.trim() || "你"}
                  </span>
                </strong>
              </div>
            ) : null}
          </div>
        );
    }
  }
}
