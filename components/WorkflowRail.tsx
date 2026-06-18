import type { ReactNode } from "react";

export type WorkflowVerb = "Inspect" | "Charge" | "Case" | "Secure" | "Invoice" | "Email";

export const workflowSteps: { verb: WorkflowVerb; label: string; detail: string }[] = [
  { verb: "Inspect", label: "Job", detail: "Customer, address, time, status, and notes." },
  { verb: "Case", label: "Photos", detail: "Before, after, serial numbers, and job proof." },
  { verb: "Charge", label: "Items", detail: "Parts, labor, diagnostic, and custom work." },
  { verb: "Secure", label: "Options", detail: "Good, Better, Best customer choices." },
  { verb: "Invoice", label: "Invoice", detail: "Paper-style PDF draft." },
  { verb: "Email", label: "Send", detail: "Owner marks sent and downloads the PDF." }
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
              <strong>{step.label}</strong>
              {!compact ? <small>{step.detail}</small> : null}
            </span>
          </div>
        );
      })}
      {action ? <div className="workflow-action">{action}</div> : null}
    </div>
  );
}
