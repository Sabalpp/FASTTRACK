import { demoMode } from "@/lib/runtime";
import { createId } from "@/lib/id";
import { protectedJson } from "@/lib/protected-api-client";
import type { InvoiceSignature, SignaturePurpose, SignatureSignerRole } from "@/lib/types";

const DEMO_SIGNATURES_KEY = "hvac-plumbing-mvp-signatures-v1";

export type SignatureTarget = { type: "invoice" | "job"; id: string };

export type SaveSignatureInput = {
  target: SignatureTarget;
  purpose: SignaturePurpose;
  signerName: string;
  signerRole: SignatureSignerRole;
  image: Blob;
  width: number;
  height: number;
  invoiceId?: string;
  jobId: string;
  collectedBy: string;
};

export async function loadSignatures(target: SignatureTarget): Promise<InvoiceSignature[]> {
  if (demoMode) {
    return readDemoSignatures().filter((signature) => (
      target.type === "invoice" ? signature.invoiceId === target.id : signature.jobId === target.id
    ));
  }

  const result = await protectedJson<{ signatures: InvoiceSignature[] }>(
    `/api/${target.type === "invoice" ? "invoices" : "jobs"}/${target.id}/signatures`,
    { cache: "no-store" }
  );
  return result.signatures;
}

export async function saveSignature(input: SaveSignatureInput): Promise<InvoiceSignature> {
  if (demoMode) return saveDemoSignature(input);

  const form = new FormData();
  form.set("signature", input.image, "signature.png");
  form.set("purpose", input.purpose);
  form.set("signerName", input.signerName.trim());
  form.set("signerRole", input.signerRole);
  form.set("width", String(input.width));
  form.set("height", String(input.height));

  const result = await protectedJson<{ signature: InvoiceSignature }>(
    `/api/${input.target.type === "invoice" ? "invoices" : "jobs"}/${input.target.id}/signatures`,
    { method: "POST", body: form }
  );
  return result.signature;
}

export async function rejectSignature(target: SignatureTarget, signatureId: string, reason: string) {
  if (demoMode) {
    const signatures = readDemoSignatures();
    const now = new Date().toISOString();
    const updated = signatures.map((signature) => signature.id === signatureId
      ? { ...signature, status: "rejected" as const, rejectedAt: now, rejectionReason: reason }
      : signature);
    persistDemoSignatures(updated);
    return updated.find((signature) => signature.id === signatureId)!;
  }

  const result = await protectedJson<{ signature: InvoiceSignature }>(
    `/api/${target.type === "invoice" ? "invoices" : "jobs"}/${target.id}/signatures`,
    {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signatureId, reason })
    }
  );
  return result.signature;
}

async function saveDemoSignature(input: SaveSignatureInput) {
  const imageUrl = await blobToDataUrl(input.image);
  const bytes = new Uint8Array(await input.image.arrayBuffer());
  const hashBytes = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(hashBytes)).map((value) => value.toString(16).padStart(2, "0")).join("");
  const now = new Date().toISOString();
  const current = readDemoSignatures().map((signature) => (
    signature.status === "active"
    && signature.purpose === input.purpose
    && (input.purpose === "work_completion" ? signature.jobId === input.jobId : signature.invoiceId === input.invoiceId)
      ? { ...signature, status: "rejected" as const, rejectedAt: now, rejectionReason: "Replaced by a newly collected signature." }
      : signature
  ));
  const signature: InvoiceSignature = {
    id: createId(),
    invoiceId: input.invoiceId,
    jobId: input.jobId,
    purpose: input.purpose,
    signerName: input.signerName.trim(),
    signerRole: input.signerRole,
    status: "active",
    imageUrl,
    contentSha256: hash,
    documentSha256: hash,
    signedAt: now,
    collectedBy: input.collectedBy,
    createdAt: now
  };
  persistDemoSignatures([signature, ...current]);
  return signature;
}

function persistDemoSignatures(signatures: InvoiceSignature[]) {
  try {
    window.localStorage.setItem(DEMO_SIGNATURES_KEY, JSON.stringify(signatures));
  } catch (error) {
    console.warn("Demo signatures could not be saved on this device.", error);
  }
}

function readDemoSignatures(): InvoiceSignature[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(DEMO_SIGNATURES_KEY);
    return raw ? JSON.parse(raw) as InvoiceSignature[] : [];
  } catch {
    return [];
  }
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("The signature image could not be prepared."));
    reader.readAsDataURL(blob);
  });
}
