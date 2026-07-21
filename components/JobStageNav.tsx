"use client";

import { Camera, ClipboardList, FileCheck2, ReceiptText, ShieldCheck, Wrench } from "lucide-react";
import type { CSSProperties } from "react";
import styles from "./JobStageNav.module.css";

export type JobStage = "overview" | "photos" | "work" | "approval" | "after" | "completion" | "invoice";

export const jobStages: Array<{
  id: JobStage;
  label: string;
  shortLabel: string;
  description: string;
}> = [
  { id: "overview", label: "Overview", shortLabel: "Overview", description: "Customer, dispatch, and arrival" },
  { id: "photos", label: "Before photos", shortLabel: "Before", description: "Document conditions before work" },
  { id: "work", label: "Estimate", shortLabel: "Estimate", description: "Build the proposed scope and price" },
  { id: "approval", label: "Authorization", shortLabel: "Authorize", description: "Customer approval before work" },
  { id: "after", label: "After photos", shortLabel: "After", description: "Document completed work" },
  { id: "completion", label: "Completion", shortLabel: "Complete", description: "Customer confirms completed work" },
  { id: "invoice", label: "Invoice", shortLabel: "Invoice", description: "Build and open the invoice" }
];

const stageIcons = {
  overview: ClipboardList,
  photos: Camera,
  work: Wrench,
  approval: ShieldCheck,
  after: Camera,
  completion: FileCheck2,
  invoice: ReceiptText
} satisfies Record<JobStage, typeof Camera>;

export function JobStageNav({
  active,
  onChange,
  counts,
  completion,
  visibleStages,
  disabledStages = []
}: {
  active: JobStage;
  onChange: (stage: JobStage) => void;
  counts?: Partial<Record<JobStage, number>>;
  completion?: Partial<Record<JobStage, boolean>>;
  visibleStages?: JobStage[];
  disabledStages?: JobStage[];
}) {
  const stages = visibleStages
    ? jobStages.filter((stage) => visibleStages.includes(stage.id))
    : jobStages;

  return (
    <nav className={styles.nav} aria-label="Job workflow">
      <div className={styles.scroller} role="tablist" aria-label="Job stages" style={{ "--stage-count": stages.length } as CSSProperties}>
        {stages.map((stage) => {
          const Icon = stageIcons[stage.id];
          const selected = stage.id === active;
          const complete = completion?.[stage.id] === true;
          const count = counts?.[stage.id];
          const disabled = disabledStages.includes(stage.id) && !selected;

          return (
            <button
              key={stage.id}
              type="button"
              role="tab"
              id={`job-stage-${stage.id}`}
              aria-controls={`job-stage-panel-${stage.id}`}
              aria-label={stage.shortLabel}
              aria-selected={selected}
              aria-disabled={disabled}
              disabled={disabled}
              className={styles.tab}
              data-active={selected || undefined}
              data-complete={complete || undefined}
              onClick={() => onChange(stage.id)}
            >
              <span className={styles.icon} aria-hidden="true">
                <Icon size={19} strokeWidth={2.15} />
              </span>
              <span className={styles.copy}>
                <strong>{stage.shortLabel}</strong>
              </span>
              {typeof count === "number" && count > 0 ? <span className={styles.count}>{count}</span> : null}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
