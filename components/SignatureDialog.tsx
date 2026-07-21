"use client";

import { Eraser, Keyboard, PenLine, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { SignaturePad, type SignaturePadHandle } from "@/components/SignaturePad";
import { Button, Field } from "@/components/ui";
import type { SignatureSignerRole } from "@/lib/types";

export function SignatureDialog({
  open,
  title,
  description,
  signerRole,
  defaultSignerName,
  onCancel,
  onSave
}: {
  open: boolean;
  title: string;
  description: string;
  signerRole: SignatureSignerRole;
  defaultSignerName?: string;
  onCancel: () => void;
  onSave: (input: { signerName: string; signerRole: SignatureSignerRole; image: Blob; width: number; height: number }) => Promise<void>;
}) {
  const padRef = useRef<SignaturePadHandle | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCancelRef = useRef(onCancel);
  const [signerName, setSignerName] = useState(defaultSignerName ?? "");
  const [strokeCount, setStrokeCount] = useState(0);
  const [signatureMethod, setSignatureMethod] = useState<"drawn" | "typed" | undefined>();
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState<string | undefined>();
  savingRef.current = saving;
  onCancelRef.current = onCancel;

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    setSignerName(defaultSignerName ?? "");
    setStrokeCount(0);
    setSignatureMethod(undefined);
    setError(undefined);
    const focusTimer = window.setTimeout(() => nameInputRef.current?.focus(), 30);
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !savingRef.current) {
        event.preventDefault();
        onCancelRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), canvas[tabindex="0"], [href], [tabindex]:not([tabindex="-1"])'
      ) ?? []).filter((element) => !element.hasAttribute("hidden"));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", handleKey);
      if (previousFocusRef.current?.isConnected) previousFocusRef.current.focus({ preventScroll: true });
    };
  }, [defaultSignerName, open]);

  if (!open) return null;

  async function save() {
    const cleanName = signerName.trim();
    if (cleanName.length < 2) {
      setError("Enter the signer's full name.");
      nameInputRef.current?.focus();
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      const image = await padRef.current?.exportPng();
      if (!image) throw new Error("Draw a signature before saving.");
      await onSave({ signerName: cleanName, signerRole, image: image.blob, width: image.width, height: image.height });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The signature could not be saved. Nothing was approved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="signature-dialog-backdrop" role="presentation">
      <section ref={dialogRef} className="signature-dialog" role="dialog" aria-modal="true" aria-labelledby="signature-dialog-title" aria-describedby="signature-dialog-description">
        <div className="signature-dialog-header">
          <div>
            <p className="eyebrow">{strokeCount > 0 ? "Signature in progress" : "Ready to sign"}</p>
            <h2 id="signature-dialog-title">{title}</h2>
            <p className="muted" id="signature-dialog-description">{description}</p>
          </div>
          <button className="icon-button" type="button" onClick={onCancel} disabled={saving} aria-label="Cancel signature">
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <div className="signature-dialog-identity">
          <Field label="Signer full name">
            <input
              ref={nameInputRef}
              value={signerName}
              onChange={(event) => setSignerName(event.target.value)}
              autoComplete="name"
              disabled={saving || signatureMethod === "typed"}
            />
          </Field>
          <div className="signature-role-readout">
            <span>Signing as</span>
            <strong>{signerRole === "customer" ? "Customer" : signerRole === "technician" ? "Technician" : "Company"}</strong>
          </div>
        </div>

        <SignaturePad ref={padRef} onStrokeCountChange={setStrokeCount} onSignatureMethodChange={setSignatureMethod} />

        {error ? <p className="field-error signature-save-error" role="alert">{error}</p> : null}
        <div className="signature-dialog-actions">
          <div>
            <Button
              variant="secondary"
              onClick={() => {
                const cleanName = signerName.trim();
                if (cleanName.length < 2) {
                  setError("Enter the signer's full name before using a typed signature.");
                  nameInputRef.current?.focus();
                  return;
                }
                setError(undefined);
                padRef.current?.setTypedName(cleanName);
              }}
              disabled={saving || signatureMethod === "typed"}
            >
              <Keyboard size={16} aria-hidden="true" /> Use typed signature
            </Button>
            <Button variant="secondary" onClick={() => padRef.current?.undo()} disabled={saving || strokeCount === 0}>
              <RotateCcw size={16} aria-hidden="true" /> Undo
            </Button>
            <Button variant="secondary" onClick={() => padRef.current?.clear()} disabled={saving || strokeCount === 0}>
              <Eraser size={16} aria-hidden="true" /> Clear
            </Button>
          </div>
          <div>
            <Button variant="secondary" onClick={onCancel} disabled={saving}>Cancel</Button>
            <Button onClick={() => void save()} disabled={saving || strokeCount === 0 || signerName.trim().length < 2}>
              <PenLine size={16} aria-hidden="true" /> {saving ? "Saving signature..." : "Save signature"}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
