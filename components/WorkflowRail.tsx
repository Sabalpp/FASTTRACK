import type { ReactNode } from "react";

export type WorkflowVerb = "Inspect" | "Charge" | "Case" | "Secure" | "Invoice" | "Email";

export const workflowSteps: { verb: WorkflowVerb; caption: string; detail: string }[] = [
  { verb: "Inspect", caption: "Diagnose", detail: "Open the job, customer, notes, and status." },
  { verb: "Case", caption: "Document", detail: "Attach before/after photos and job context." },
  { verb: "Charge", caption: "Work items", detail: "Log diagnostic, parts, labor, and custom charges." },
  { verb: "Secure", caption: "Estimate", detail: "Review customer-facing options before invoice." },
  { verb: "Invoice", caption: "Draft", detail: "Generate a clean owner-review invoice." },
  { verb: "Email", caption: "Send", detail: "Owner approves and sends the PDF." }
];

export function WorkflowRail({
  active,
  compact = false,
  vertical = false,
  action
}: {
  active?: WorkflowVerb;
  compact?: boolean;
  vertical?: boolean;
  action?: ReactNode;
}) {
  return (
    <div className={`workflow-rail ${compact ? "workflow-rail-compact" : ""} ${vertical ? "workflow-rail-vertical" : ""}`}>
      {workflowSteps.map((step, index) => {
        const isActive = active === step.verb;
        return (
          <div key={step.verb} className={`workflow-step ${isActive ? "workflow-step-active" : ""}`}>
            <span className="workflow-index">{index + 1}</span>
            <span>
              <strong>{step.verb}</strong>
              {!compact ? <small>{step.caption}</small> : null}
            </span>
          </div>
        );
      })}
      {action ? <div className="workflow-action">{action}</div> : null}
    </div>
  );
}
