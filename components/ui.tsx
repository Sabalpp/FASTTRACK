import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  description,
  action
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {action ? <div className="page-action">{action}</div> : null}
    </div>
  );
}

export function ButtonLink({ href, children, variant = "primary" }: { href: string; children: ReactNode; variant?: "primary" | "secondary" }) {
  return (
    <Link href={href} className={`button ${variant === "secondary" ? "button-secondary" : ""}`}>
      {children}
    </Link>
  );
}

export function Button({ children, variant = "primary", type = "button", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  return (
    <button type={type} className={`button ${variant === "secondary" ? "button-secondary" : ""} ${variant === "danger" ? "button-danger" : ""}`} {...props}>
      {children}
    </button>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`card ${className}`}>{children}</section>;
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <p>{description}</p>
      {action ? <div>{action}</div> : null}
    </div>
  );
}

export function StatusPill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "warn" | "bad" | "info" }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function TwoColumn({ children }: { children: ReactNode }) {
  return <div className="two-column">{children}</div>;
}

export function ThreeColumn({ children }: { children: ReactNode }) {
  return <div className="three-column">{children}</div>;
}
