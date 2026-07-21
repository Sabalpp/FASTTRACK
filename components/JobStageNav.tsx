"use client";

import { Camera, ClipboardList, FileCheck2, ReceiptText, Wrench } from "lucide-react";
import styles from "./JobStageNav.module.css";

export type JobStage = "overview" | "photos" | "work" | "approval" | "invoice";

export const jobStages: Array<{
  id: JobStage;
  label: string;
  shortLabel: string;
  description: string;
}> = [
  { id: "overview", label: "Overview", shortLabel: "Overview", description: "Customer, dispatch, and arrival" },
  { id: "photos", label: "Photos", shortLabel: "Photos", description: "Before, after, and job proof" },
  { id: "work", label: "Work", shortLabel: "Work", description: "Services, parts, and options" },
  { id: "approval", label: "Approval", shortLabel: "Approval", description: "Customer review and signature" },
  { id: "invoice", label: "Invoice", shortLabel: "Invoice", description: "Build and open the invoice" }
];

const stageIcons = {
  overview: ClipboardList,
  photos: Camera,
  work: Wrench,
  approval: FileCheck2,
  invoice: ReceiptText
} satisfies Record<JobStage, typeof Camera>;

export function JobStageNav({
  active,
  onChange,
  counts,
  completion
}: {
  active: JobStage;
  onChange: (stage: JobStage) => void;
  counts?: Partial<Record<JobStage, number>>;
  completion?: Partial<Record<JobStage, boolean>>;
}) {
  return (
    <nav className={styles.nav} aria-label="Job workflow">
      <div className={styles.scroller} role="tablist" aria-label="Job stages">
        {jobStages.map((stage) => {
          const Icon = stageIcons[stage.id];
          const selected = stage.id === active;
          const complete = completion?.[stage.id] === true;
          const count = counts?.[stage.id];

          return (
            <button
              key={stage.id}
              type="button"
              role="tab"
              id={`job-stage-${stage.id}`}
              aria-controls={`job-stage-panel-${stage.id}`}
              aria-selected={selected}
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
                <small>{stage.description}</small>
              </span>
              {typeof count === "number" && count > 0 ? <span className={styles.count}>{count}</span> : null}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
