"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Camera,
  Check,
  FilePlus2,
  LoaderCircle,
  Moon,
  Sparkles,
  Sunrise,
  Upload,
  X,
} from "lucide-react";

import {
  CREATE_ACTOR_PERSONALITY_TRAITS,
  CREATE_ACTOR_SLEEP_AXIS_MINUTES,
  CREATE_ACTOR_SLEEP_DEFAULT_END,
  CREATE_ACTOR_SLEEP_DEFAULT_START,
  CREATE_ACTOR_SLEEP_MAX_GAP_MINUTES,
  CREATE_ACTOR_SLEEP_MIN_GAP_MINUTES,
  CREATE_ACTOR_SLEEP_STEP_MINUTES,
  CREATE_ACTOR_SOURCE_OPTIONS,
  MBTI_AXIS_CONFIG,
  MBTI_PERSONAS,
  type CreateActorSleepHandleState,
  type CreateActorSourceId,
  type CreateActorStepId,
  type MbtiAxis,
} from "../constants";
import {
  axisMinutesToClockLabel,
  buildMbtiCode,
  clampAxisMinutes,
  computeCurrentAxisMinutes,
  createActorNameInitial,
  formatCreateActorBirthday,
  formatSleepDuration,
  snapAxisMinutes,
} from "../helpers";
import { createActor } from "@/transport/dashboard";
import type { ActorSummary } from "@/types/dashboard/v1beta1";
import styles from "./create-actor.module.css";

export function CreateActorOverlay({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated?: (actor: ActorSummary) => void;
}) {
  const [currentStep, setCurrentStep] = useState<CreateActorStepId>(1);
  const [stepMotion, setStepMotion] = useState<"forward" | "backward">(
    "forward",
  );
  const [exitingSubtitle, setExitingSubtitle] = useState<{
    id: number;
    text: string;
    direction: "forward" | "backward";
  } | null>(null);
  const subtitleSeqRef = useRef(0);
  const subtitleExitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const [source, setSource] = useState<CreateActorSourceId>("blank");
  const [actorName, setActorName] = useState("");
  const [roleBook, setRoleBook] = useState("");
  const [mbtiAxes, setMbtiAxes] = useState<Record<MbtiAxis, string>>({
    EI: "E",
    SN: "N",
    TF: "T",
    JP: "J",
  });
  const [selectedTraits, setSelectedTraits] = useState<string[]>([]);
  const [createdAt] = useState(() => new Date());
  const [sleepStart, setSleepStart] = useState<number>(
    CREATE_ACTOR_SLEEP_DEFAULT_START,
  );
  const [sleepEnd, setSleepEnd] = useState<number>(
    CREATE_ACTOR_SLEEP_DEFAULT_END,
  );

  const [submitting, setSubmitting] = useState(false);
  const [justSucceeded, setJustSucceeded] = useState(false);
  const closingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [toast, setToast] = useState<{
    id: number;
    message: string;
    kind: "success" | "error";
  } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastSeqRef = useRef(0);

  const [nowAxisMin, setNowAxisMin] = useState(() =>
    computeCurrentAxisMinutes(),
  );
  useEffect(() => {
    const tick = () => setNowAxisMin(computeCurrentAxisMinutes());
    const interval = setInterval(tick, 30 * 1000);
    return () => clearInterval(interval);
  }, []);

  const steps: Array<{
    id: CreateActorStepId;
    title: string;
    description: string;
    subtitle: string;
  }> = [
    {
      id: 1,
      title: "记忆碎片",
      description: "从白纸开始，或把已有的痕迹带到这里，让一切有个起点。",
      subtitle: "我好像听见了很遥远的声音，在哪里……",
    },
    {
      id: 2,
      title: "写进档案",
      description: "留下名字与模样，让这份记忆不再只是模糊的影子。",
      subtitle: "我……是谁？",
    },
    {
      id: 3,
      title: "赋予灵魂",
      description: "写下那些重要之物，它会慢慢沉淀。",
      subtitle: "我能感觉到这是很重要的东西……嗯，很重要",
    },
    {
      id: 4,
      title: "赋予生命",
      description: "斗转星移，昼夜交替，让陪伴拥有自己的呼吸。",
      subtitle: "我好像做了一个很奇妙的梦……",
    },
    {
      id: 5,
      title: "期待相遇",
      description: "待档案合上，新的邂逅就会开始。",
      subtitle: "我有预感，我将度过一段难忘的时光",
    },
  ];
  const step = steps[currentStep - 1];
  const coreProgressAngle = `${
    ((currentStep - 1) * 360) / (steps.length - 1)
  }deg`;
  const railProgressScale = (currentStep - 1) / (steps.length - 1);

  useEffect(() => {
    return () => {
      if (subtitleExitTimerRef.current !== null) {
        clearTimeout(subtitleExitTimerRef.current);
      }
      if (toastTimerRef.current !== null) {
        clearTimeout(toastTimerRef.current);
      }
      if (closingTimerRef.current !== null) {
        clearTimeout(closingTimerRef.current);
      }
    };
  }, []);

  function showCreateActorToast(message: string, kind: "success" | "error") {
    if (toastTimerRef.current !== null) {
      clearTimeout(toastTimerRef.current);
    }
    toastSeqRef.current += 1;
    setToast({ id: toastSeqRef.current, message, kind });
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 1600);
  }

  const trimmedName = actorName.trim();
  const canContinue = (() => {
    if (submitting || justSucceeded) return false;
    if (currentStep === 2) return trimmedName.length > 0;
    return true;
  })();

  function goToStep(stepId: CreateActorStepId) {
    if (stepId === currentStep) {
      return;
    }

    const direction = stepId > currentStep ? "forward" : "backward";
    if (subtitleExitTimerRef.current !== null) {
      clearTimeout(subtitleExitTimerRef.current);
    }

    setStepMotion(direction);
    subtitleSeqRef.current += 1;
    setExitingSubtitle({
      id: subtitleSeqRef.current,
      text: steps[currentStep - 1].subtitle,
      direction,
    });
    setCurrentStep(stepId);
    subtitleExitTimerRef.current = setTimeout(() => {
      setExitingSubtitle(null);
      subtitleExitTimerRef.current = null;
    }, 860);
  }

  function goBack() {
    if (currentStep === 1 || submitting || justSucceeded) {
      return;
    }

    goToStep((currentStep - 1) as CreateActorStepId);
  }

  async function handleComplete() {
    if (submitting || justSucceeded) return;
    setSubmitting(true);
    try {
      const response = await createActor({
        name: trimmedName,
        roleBook: buildCreateActorRoleBook({
          roleBook,
          mbtiCode: buildMbtiCode(mbtiAxes),
          traits: selectedTraits,
          source,
        }),
        sleepSchedule: {
          startMinutes: sleepStart,
          endMinutes: sleepEnd,
        },
      });
      setSubmitting(false);
      setJustSucceeded(true);
      showCreateActorToast("档案已合上，等待相遇", "success");
      closingTimerRef.current = setTimeout(() => {
        onCreated?.(response.actor);
        if (!onCreated) {
          onClose();
        }
      }, 720);
    } catch {
      setSubmitting(false);
      showCreateActorToast("创建失败，请稍后重试", "error");
    }
  }

  function goNext() {
    if (!canContinue) return;
    if (currentStep === 5) {
      void handleComplete();
      return;
    }
    goToStep((currentStep + 1) as CreateActorStepId);
  }

  function handleAvatarClick() {
    showCreateActorToast("暂不支持", "error");
  }

  function renderStepBody() {
    switch (currentStep) {
      case 1:
        return (
          <CreateActorStepSource
            selected={source}
            onSelect={(id) => setSource(id)}
          />
        );
      case 2:
        return (
          <CreateActorStepIdentity
            name={actorName}
            onNameChange={setActorName}
            onAvatarClick={handleAvatarClick}
          />
        );
      case 3:
        return (
          <CreateActorStepSoul
            value={roleBook}
            onChange={setRoleBook}
            mbtiAxes={mbtiAxes}
            onMbtiAxisChange={(axis, option) =>
              setMbtiAxes((current) => ({ ...current, [axis]: option }))
            }
            selectedTraits={selectedTraits}
            onToggleTrait={(id) =>
              setSelectedTraits((current) => {
                if (current.includes(id)) {
                  return current.filter((trait) => trait !== id);
                }
                if (current.length >= 3) {
                  return current;
                }
                return [...current, id];
              })
            }
            onApplyPreset={() => showCreateActorToast("暂不支持", "error")}
          />
        );
      case 4:
        return (
          <CreateActorStepLife
            sleepStart={sleepStart}
            sleepEnd={sleepEnd}
            nowAxisMin={nowAxisMin}
            onChange={(start, end) => {
              setSleepStart(start);
              setSleepEnd(end);
            }}
          />
        );
      case 5:
        return (
          <CreateActorStepArchive
            name={trimmedName}
            createdAt={createdAt}
            roleBook={roleBook}
            sleepStart={sleepStart}
            sleepEnd={sleepEnd}
          />
        );
      default:
        return null;
    }
  }

  return (
    <div className={styles.createActorOverlay} role="dialog" aria-modal="true">
      <button
        type="button"
        className={styles.createActorCloseButton}
        aria-label="关闭创建角色"
        onClick={onClose}
      >
        <X aria-hidden="true" />
      </button>

      {toast ? (
        <div
          key={toast.id}
          className={`${styles.createActorToast} ${
            toast.kind === "success"
              ? styles.createActorToastSuccess
              : styles.createActorToastError
          }`}
          role={toast.kind === "success" ? "status" : "alert"}
          aria-live={toast.kind === "success" ? "polite" : "assertive"}
        >
          {toast.kind === "success" ? (
            <Check aria-hidden="true" />
          ) : (
            <X aria-hidden="true" />
          )}
          <span>{toast.message}</span>
        </div>
      ) : null}

      <section className={styles.createActorShell} aria-label="创建角色流程">
        <div className={styles.createActorTopSpacer} aria-hidden="true" />

        <div className={styles.createActorCoreSlot}>
          <div
            className={styles.createActorCore}
            data-step={currentStep}
            data-has-initial={
              currentStep > 2 && trimmedName.length > 0 ? "true" : undefined
            }
            style={
              {
                "--create-actor-progress-angle": coreProgressAngle,
              } as CSSProperties
            }
            aria-hidden="true"
          >
            <span className={styles.createActorCoreRing} />
            <span className={styles.createActorCoreAvatar}>
              {currentStep > 2 && trimmedName.length > 0
                ? createActorNameInitial(trimmedName)
                : ""}
            </span>
          </div>
        </div>

        <header className={styles.createActorIntro}>
          <span>CREATE ACTOR</span>
          <h2>创建角色</h2>
          <p className={styles.createActorIntroSubtitle} aria-live="polite">
            {exitingSubtitle ? (
              <span
                key={`exit-${exitingSubtitle.id}`}
                className={`${styles.createActorSubtitleText} ${
                  exitingSubtitle.direction === "forward"
                    ? styles.createActorSubtitleExitForward
                    : styles.createActorSubtitleExitBackward
                }`}
              >
                {exitingSubtitle.text}
              </span>
            ) : null}
            <span
              key={`enter-${currentStep}`}
              className={`${styles.createActorSubtitleText} ${
                stepMotion === "forward"
                  ? styles.createActorSubtitleEnterForward
                  : styles.createActorSubtitleEnterBackward
              }`}
            >
              {step.subtitle}
            </span>
          </p>
        </header>

        <article className={styles.createActorCard}>
          <div className={styles.createActorCardHeader}>
            <span>{String(currentStep).padStart(2, "0")}</span>
            <div>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
            </div>
          </div>
          <div className={styles.createActorStepBody} data-step={currentStep}>
            {renderStepBody()}
          </div>
        </article>

        <footer className={styles.createActorActions}>
          <button
            type="button"
            disabled={currentStep === 1 || submitting || justSucceeded}
            onClick={goBack}
          >
            上一步
          </button>
          <nav
            className={styles.createActorStepRail}
            aria-label="创建进度"
            style={
              {
                "--create-actor-rail-progress": railProgressScale,
              } as CSSProperties
            }
          >
            {steps.map((item) => {
              const isActive = item.id === currentStep;
              const isDone = item.id < currentStep;

              return (
                <button
                  key={item.id}
                  type="button"
                  className={`${styles.createActorStepChip} ${
                    isActive ? styles.createActorStepChipActive : ""
                  } ${isDone ? styles.createActorStepChipDone : ""}`}
                  disabled={
                    item.id > currentStep || submitting || justSucceeded
                  }
                  onClick={() => goToStep(item.id)}
                  aria-label={`${item.id}. ${item.title}`}
                >
                  <span>{item.id}</span>
                </button>
              );
            })}
          </nav>
          <button
            type="button"
            className={styles.createActorPrimaryAction}
            onClick={goNext}
            disabled={!canContinue}
            data-loading={submitting ? "true" : undefined}
          >
            {submitting ? (
              <LoaderCircle
                aria-hidden="true"
                className={styles.createActorPrimarySpinner}
              />
            ) : justSucceeded ? (
              <>
                <Check aria-hidden="true" />
                <span>创建成功</span>
              </>
            ) : currentStep === 5 ? (
              "完成"
            ) : (
              "继续"
            )}
          </button>
        </footer>

        <div className={styles.createActorBottomSpacer} aria-hidden="true" />
      </section>
    </div>
  );
}

function buildCreateActorRoleBook({
  roleBook,
  mbtiCode,
  traits,
  source,
}: {
  roleBook: string;
  mbtiCode: string;
  traits: string[];
  source: CreateActorSourceId;
}) {
  const sections = [
    roleBook.trim(),
    `导入方式：${source}`,
    `MBTI：${mbtiCode}`,
    traits.length > 0 ? `性格关键词：${traits.join("、")}` : "",
  ].filter(Boolean);
  return sections.join("\n\n");
}

function CreateActorStepSource({
  selected,
  onSelect,
}: {
  selected: CreateActorSourceId;
  onSelect: (id: CreateActorSourceId) => void;
}) {
  return (
    <div
      className={styles.createActorSourceGrid}
      role="radiogroup"
      aria-label="选择起源方式"
    >
      {CREATE_ACTOR_SOURCE_OPTIONS.map((option) => {
        const active = option.enabled && option.id === selected;
        return (
          <div
            key={option.id}
            className={`${styles.createActorSourceCard} ${
              active ? styles.createActorSourceCardActive : ""
            } ${!option.enabled ? styles.createActorSourceCardDisabled : ""}`}
          >
            <button
              type="button"
              className={styles.createActorSourceCardBody}
              disabled={!option.enabled}
              role="radio"
              aria-checked={active}
              aria-disabled={!option.enabled}
              onClick={() => {
                if (option.enabled) onSelect(option.id);
              }}
            >
              <span className={styles.createActorSourceIcon} aria-hidden="true">
                {option.icon === "blank" ? (
                  <FilePlus2 />
                ) : option.icon === "import" ? (
                  <Upload />
                ) : (
                  <Sparkles />
                )}
              </span>
              <span className={styles.createActorSourceCopy}>
                <span className={styles.createActorSourceLabel}>
                  {option.label}
                </span>
                <span className={styles.createActorSourceDescription}>
                  {option.description}
                </span>
              </span>
            </button>
            {!option.enabled ? (
              <div
                className={styles.createActorSourceComingSoon}
                aria-hidden="true"
              >
                <span>Coming soon</span>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function CreateActorStepIdentity({
  name,
  onNameChange,
  onAvatarClick,
}: {
  name: string;
  onNameChange: (value: string) => void;
  onAvatarClick: () => void;
}) {
  const initial = createActorNameInitial(name);
  return (
    <div className={styles.createActorIdentityGroup}>
      <button
        type="button"
        className={styles.createActorIdentityAvatar}
        aria-label="设置角色头像"
        onClick={onAvatarClick}
      >
        <span className={styles.createActorIdentityAvatarText}>
          {initial}
        </span>
        <span className={styles.createActorIdentityAvatarOverlay} aria-hidden="true">
          <Camera />
        </span>
      </button>
      <input
        id="create-actor-name"
        className={styles.createActorNameInput}
        type="text"
        autoComplete="off"
        maxLength={32}
        placeholder="给ta取一个名字吧"
        aria-label="角色名称"
        value={name}
        onChange={(event) => onNameChange(event.target.value)}
      />
    </div>
  );
}

function CreateActorStepSoul({
  value,
  onChange,
  mbtiAxes,
  onMbtiAxisChange,
  selectedTraits,
  onToggleTrait,
  onApplyPreset,
}: {
  value: string;
  onChange: (value: string) => void;
  mbtiAxes: Record<MbtiAxis, string>;
  onMbtiAxisChange: (axis: MbtiAxis, option: string) => void;
  selectedTraits: string[];
  onToggleTrait: (id: string) => void;
  onApplyPreset: () => void;
}) {
  const mbtiCode = buildMbtiCode(mbtiAxes);
  const persona = MBTI_PERSONAS[mbtiCode] ?? MBTI_PERSONAS.ESFJ;

  return (
    <div className={styles.createActorSoulLayout}>
      <textarea
        id="create-actor-role-book"
        className={styles.createActorTextarea}
        placeholder="记录这个角色的身世、性格、语言特点……"
        aria-label="角色书"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
      />
      <div className={styles.createActorSoulDivider} aria-hidden="true" />
      <aside
        className={styles.createActorSoulPresets}
        aria-label="预设模板"
        data-family={persona.family}
      >
        <div className={styles.createActorSoulPresetsScroll}>
          <section className={styles.createActorSoulPresetSection}>
            <div className={styles.createActorSoulPresetSectionHeader}>
              <span className={styles.createActorSoulPresetSectionTitle}>
                MBTI
              </span>
              <span
                className={styles.createActorSoulMbtiCode}
                data-family={persona.family}
              >
                {persona.code}
                <span className={styles.createActorSoulMbtiTitle}>
                  {persona.title}
                </span>
              </span>
            </div>
            <div className={styles.createActorSoulMbtiGrid}>
              {MBTI_AXIS_CONFIG.map((axis) => (
                <div
                  key={axis.axis}
                  className={styles.createActorSoulMbtiPair}
                  data-family={persona.family}
                >
                  {axis.options.map((option) => {
                    const active = mbtiAxes[axis.axis] === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        title={option.title}
                        aria-pressed={active}
                        className={styles.createActorSoulMbtiChip}
                        data-active={active ? "true" : undefined}
                        onClick={() => onMbtiAxisChange(axis.axis, option.id)}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </section>

          <section className={styles.createActorSoulPresetSection}>
            <div className={styles.createActorSoulPresetSectionHeader}>
              <span className={styles.createActorSoulPresetSectionTitle}>
                性格关键词
              </span>
              <span
                className={styles.createActorSoulPresetHint}
                data-full={selectedTraits.length >= 3 ? "true" : undefined}
              >
                {selectedTraits.length} / 3
              </span>
            </div>
            <div className={styles.createActorSoulTraitList}>
              {CREATE_ACTOR_PERSONALITY_TRAITS.map((trait) => {
                const active = selectedTraits.includes(trait.id);
                const disabled = !active && selectedTraits.length >= 3;
                return (
                  <button
                    key={trait.id}
                    type="button"
                    aria-pressed={active}
                    data-active={active ? "true" : undefined}
                    data-disabled={disabled ? "true" : undefined}
                    className={styles.createActorSoulTraitChip}
                    onClick={() => onToggleTrait(trait.id)}
                  >
                    {trait.label}
                  </button>
                );
              })}
            </div>
          </section>
        </div>

        <button
          type="button"
          className={styles.createActorSoulApplyButton}
          disabled
          aria-disabled="true"
          onClick={onApplyPreset}
        >
          <span>应用预设</span>
          <span className={styles.createActorSoulApplyBadge}>Coming soon</span>
        </button>
      </aside>
    </div>
  );
}

function CreateActorStepLife({
  sleepStart,
  sleepEnd,
  nowAxisMin,
  onChange,
}: {
  sleepStart: number;
  sleepEnd: number;
  nowAxisMin: number;
  onChange: (start: number, end: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<CreateActorSleepHandleState | null>(null);
  const [dragging, setDragging] = useState<null | "start" | "end" | "range">(
    null,
  );

  function minutesFromClientX(clientX: number, trackWidth: number) {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || trackWidth <= 0) return 0;
    const ratio = (clientX - rect.left) / trackWidth;
    return snapAxisMinutes(ratio * CREATE_ACTOR_SLEEP_AXIS_MINUTES);
  }

  function applyDrag(clientX: number) {
    const state = dragStateRef.current;
    if (!state) return;
    const value = minutesFromClientX(clientX, state.trackWidth);

    if (state.handle === "start") {
      const next = Math.max(
        sleepEnd - CREATE_ACTOR_SLEEP_MAX_GAP_MINUTES,
        Math.min(value, sleepEnd - CREATE_ACTOR_SLEEP_MIN_GAP_MINUTES),
      );
      onChange(clampAxisMinutes(next), sleepEnd);
    } else if (state.handle === "end") {
      const next = Math.min(
        sleepStart + CREATE_ACTOR_SLEEP_MAX_GAP_MINUTES,
        Math.max(value, sleepStart + CREATE_ACTOR_SLEEP_MIN_GAP_MINUTES),
      );
      onChange(sleepStart, clampAxisMinutes(next));
    } else {
      const width = Math.min(
        sleepEnd - sleepStart,
        CREATE_ACTOR_SLEEP_MAX_GAP_MINUTES,
      );
      let nextStart = snapAxisMinutes(value - state.offsetMinutes);
      if (nextStart < 0) nextStart = 0;
      if (nextStart + width > CREATE_ACTOR_SLEEP_AXIS_MINUTES) {
        nextStart = CREATE_ACTOR_SLEEP_AXIS_MINUTES - width;
      }
      onChange(nextStart, nextStart + width);
    }
  }

  function beginDrag(
    handle: "start" | "end" | "range",
    event: ReactPointerEvent<Element>,
  ) {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    const valueAtPointer = minutesFromClientX(event.clientX, rect.width);
    dragStateRef.current = {
      handle,
      pointerId: event.pointerId,
      offsetMinutes: handle === "range" ? valueAtPointer - sleepStart : 0,
      trackWidth: rect.width,
    };
    setDragging(handle);
  }

  function handleDragMove(event: ReactPointerEvent<Element>) {
    const state = dragStateRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    event.preventDefault();
    applyDrag(event.clientX);
  }

  function endDrag(event: ReactPointerEvent<Element>) {
    const state = dragStateRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const target = event.currentTarget as Element;
    if (target.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }
    dragStateRef.current = null;
    setDragging(null);
  }

  function handleHandleKeyDown(
    handle: "start" | "end",
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ) {
    const multiplier = event.shiftKey ? 6 : 1;
    const delta = CREATE_ACTOR_SLEEP_STEP_MINUTES * multiplier;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      if (handle === "start") {
        const next = Math.max(
          sleepEnd - CREATE_ACTOR_SLEEP_MAX_GAP_MINUTES,
          sleepStart - delta,
        );
        onChange(clampAxisMinutes(next), sleepEnd);
      } else {
        const next = Math.max(
          sleepStart + CREATE_ACTOR_SLEEP_MIN_GAP_MINUTES,
          sleepEnd - delta,
        );
        onChange(sleepStart, clampAxisMinutes(next));
      }
    } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      if (handle === "start") {
        const next = Math.min(
          sleepEnd - CREATE_ACTOR_SLEEP_MIN_GAP_MINUTES,
          sleepStart + delta,
        );
        onChange(clampAxisMinutes(next), sleepEnd);
      } else {
        const next = Math.min(
          sleepStart + CREATE_ACTOR_SLEEP_MAX_GAP_MINUTES,
          sleepEnd + delta,
        );
        onChange(sleepStart, clampAxisMinutes(next));
      }
    }
  }

  const startPercent = (sleepStart / CREATE_ACTOR_SLEEP_AXIS_MINUTES) * 100;
  const endPercent = (sleepEnd / CREATE_ACTOR_SLEEP_AXIS_MINUTES) * 100;
  const nowPercent = (nowAxisMin / CREATE_ACTOR_SLEEP_AXIS_MINUTES) * 100;

  const bigTicks = Array.from({ length: 25 }, (_, i) => i);
  const axisLabels = [
    { hour: 0, label: "12:00" },
    { hour: 6, label: "18:00" },
    { hour: 12, label: "00:00" },
    { hour: 18, label: "06:00" },
    { hour: 24, label: "12:00" },
  ];

  return (
    <div className={styles.createActorSleepBlock}>
      <div className={styles.createActorSleepSummary}>
        <div
          className={`${styles.createActorSleepSummaryCell} ${styles.createActorSleepSummarySleep}`}
        >
          <span
            className={styles.createActorSleepSummaryIcon}
            aria-hidden="true"
          >
            <Moon />
          </span>
          <span className={styles.createActorSleepSummaryLabel}>入睡</span>
          <span className={styles.createActorSleepSummaryValue}>
            {axisMinutesToClockLabel(sleepStart)}
          </span>
        </div>
        <div className={styles.createActorSleepSummaryDuration}>
          <span>持续</span>
          <span>{formatSleepDuration(sleepStart, sleepEnd)}</span>
        </div>
        <div
          className={`${styles.createActorSleepSummaryCell} ${styles.createActorSleepSummaryWake}`}
        >
          <span
            className={styles.createActorSleepSummaryIcon}
            aria-hidden="true"
          >
            <Sunrise />
          </span>
          <span className={styles.createActorSleepSummaryLabel}>起床</span>
          <span className={styles.createActorSleepSummaryValue}>
            {axisMinutesToClockLabel(sleepEnd)}
          </span>
        </div>
      </div>

      <div
        className={`${styles.createActorSleepTrackWrap} ${
          dragging ? styles.createActorSleepTrackWrapActive : ""
        }`}
      >
        <div ref={trackRef} className={styles.createActorSleepTrack}>
          <div className={styles.createActorSleepTicks} aria-hidden="true">
            {bigTicks.map((hour) => (
              <span
                key={hour}
                className={`${styles.createActorSleepTick} ${
                  hour % 6 === 0 ? styles.createActorSleepTickMajor : ""
                }`}
                style={{ left: `${(hour / 24) * 100}%` }}
              />
            ))}
          </div>

          <div
            className={styles.createActorSleepRange}
            style={{
              left: `${startPercent}%`,
              width: `${Math.max(0, endPercent - startPercent)}%`,
            }}
            onPointerDown={(event) => beginDrag("range", event)}
            onPointerMove={handleDragMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            role="presentation"
          />

          {nowAxisMin >= 0 && nowAxisMin <= CREATE_ACTOR_SLEEP_AXIS_MINUTES ? (
            <div
              className={styles.createActorSleepNow}
              style={{ left: `${nowPercent}%` }}
              aria-hidden="true"
            >
              <span className={styles.createActorSleepNowDot} />
              <span className={styles.createActorSleepNowLine} />
              <span className={styles.createActorSleepNowLabel}>
                现在 {axisMinutesToClockLabel(nowAxisMin)}
              </span>
            </div>
          ) : null}

          <button
            type="button"
            className={`${styles.createActorSleepThumb} ${styles.createActorSleepThumbStart} ${
              dragging === "start" ? styles.createActorSleepThumbActive : ""
            }`}
            style={{ left: `${startPercent}%` }}
            aria-label={`入睡时间 ${axisMinutesToClockLabel(sleepStart)}`}
            onPointerDown={(event) => beginDrag("start", event)}
            onPointerMove={handleDragMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={(event) => handleHandleKeyDown("start", event)}
          >
            <Moon aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`${styles.createActorSleepThumb} ${styles.createActorSleepThumbEnd} ${
              dragging === "end" ? styles.createActorSleepThumbActive : ""
            }`}
            style={{ left: `${endPercent}%` }}
            aria-label={`起床时间 ${axisMinutesToClockLabel(sleepEnd)}`}
            onPointerDown={(event) => beginDrag("end", event)}
            onPointerMove={handleDragMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={(event) => handleHandleKeyDown("end", event)}
          >
            <Sunrise aria-hidden="true" />
          </button>
        </div>
        <div className={styles.createActorSleepAxis} aria-hidden="true">
          {axisLabels.map((tick) => (
            <span
              key={tick.hour}
              className={styles.createActorSleepAxisLabel}
              style={{ left: `${(tick.hour / 24) * 100}%` }}
            >
              {tick.label}
            </span>
          ))}
        </div>
      </div>

      <p className={styles.createActorSleepHint}>
        拖动两端或整段区间调整作息，睡眠时长 6～12 小时
      </p>
    </div>
  );
}

function CreateActorStepArchive({
  name,
  createdAt,
  roleBook,
  sleepStart,
  sleepEnd,
}: {
  name: string;
  createdAt: Date;
  roleBook: string;
  sleepStart: number;
  sleepEnd: number;
}) {
  const displayName = name.length > 0 ? name : "未命名";
  const initial = createActorNameInitial(name);
  const roleBookPreview = roleBook.trim();

  return (
    <div className={styles.createActorArchive}>
      <div className={styles.createActorArchiveCard}>
        <div className={styles.createActorArchiveStamp} aria-hidden="true">
          ARCHIVE
        </div>
        <div className={styles.createActorArchiveHead}>
          <span
            className={styles.createActorArchiveAvatar}
            aria-hidden="true"
            data-empty={initial.length === 0 ? "true" : undefined}
          >
            {initial}
          </span>
          <div className={styles.createActorArchiveHeadText}>
            <span className={styles.createActorArchiveName}>{displayName}</span>
            <span className={styles.createActorArchiveMeta}>
              建档 · {formatCreateActorBirthday(createdAt)}
            </span>
          </div>
        </div>

        <dl className={styles.createActorArchiveList}>
          <div className={styles.createActorArchiveRow}>
            <dt>作息</dt>
            <dd>
              <span className={styles.createActorArchiveClockPair}>
                <span>
                  <Moon aria-hidden="true" />
                  {axisMinutesToClockLabel(sleepStart)}
                </span>
                <span
                  className={styles.createActorArchiveArrow}
                  aria-hidden="true"
                >
                  →
                </span>
                <span>
                  <Sunrise aria-hidden="true" />
                  {axisMinutesToClockLabel(sleepEnd)}
                </span>
              </span>
              <span className={styles.createActorArchiveMutedInline}>
                {formatSleepDuration(sleepStart, sleepEnd)}
              </span>
            </dd>
          </div>
          <div
            className={`${styles.createActorArchiveRow} ${styles.createActorArchiveRowRoleBook}`}
          >
            <dt>角色书</dt>
            <dd>
              {roleBookPreview.length > 0 ? (
                <div className={styles.createActorArchiveRoleBook}>
                  {roleBookPreview}
                </div>
              ) : (
                <span className={styles.createActorArchiveMutedInline}>
                  尚未写入
                </span>
              )}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
