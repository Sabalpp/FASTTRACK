"use client";

import { Camera, Check, ImagePlus, LockKeyhole, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { photoKinds, useAppData } from "@/lib/data-store";
import { createPhotoPreview } from "@/lib/photo-preview";
import { demoMode } from "@/lib/runtime";
import type { PhotoKind } from "@/lib/types";
import styles from "./PhotoUploader.module.css";

export function PhotoUploader({
  jobId,
  uploadedBy,
  lockedKind,
  checkpointLocked = false,
  lockedTitle,
  lockedMessage
}: {
  jobId: string;
  uploadedBy: string;
  lockedKind?: PhotoKind;
  checkpointLocked?: boolean;
  lockedTitle?: string;
  lockedMessage?: string;
}) {
  const data = useAppData();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<PhotoKind>(lockedKind ?? "before");
  const [caption, setCaption] = useState("");
  const [fileName, setFileName] = useState("");
  const [dataUrl, setDataUrl] = useState("");
  const [file, setFile] = useState<File | undefined>();
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!saved) return;
    const timeout = window.setTimeout(() => setSaved(false), 1600);
    return () => window.clearTimeout(timeout);
  }, [saved]);

  useEffect(() => {
    if (lockedKind) setKind(lockedKind);
  }, [lockedKind]);

  useEffect(() => {
    if (!checkpointLocked) return;
    setFile(undefined);
    setFileName("");
    setDataUrl("");
    setCaption("");
    setError(undefined);
    if (inputRef.current) inputRef.current.value = "";
  }, [checkpointLocked]);

  async function handleFile(nextFile: File | undefined) {
    if (!nextFile) return;
    setFile(nextFile);
    setFileName(nextFile.name);
    setProcessing(true);
    setSaved(false);
    setError(undefined);
    try {
      setDataUrl(await createPhotoPreview(nextFile));
    } catch (previewError) {
      setDataUrl("");
      setError(previewError instanceof Error ? previewError.message : "The selected photo could not be prepared.");
    } finally {
      setProcessing(false);
    }
  }

  function clearSelection() {
    setFile(undefined);
    setFileName("");
    setDataUrl("");
    setError(undefined);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!file || !dataUrl || checkpointLocked || saving) return;
    setSaving(true);
    setSaved(false);
    setError(undefined);
    try {
      await data.addPhoto({
        jobId,
        uploadedBy,
        kind,
        caption: caption.trim() || fileName || undefined,
        storagePath: dataUrl || `${jobId}/${Date.now()}_${fileName || "photo.jpg"}`,
        file
      });
      setCaption("");
      setKind(lockedKind ?? "before");
      clearSelection();
      setSaved(true);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The photo could not be saved. Try again.");
    } finally {
      setSaving(false);
    }
  }

  if (checkpointLocked) {
    const kindLabel = lockedKind === "after" ? "After photos" : "Before photos";
    return (
      <section className={styles.lockedState} role="status" aria-label={`${kindLabel} locked`}>
        <span><LockKeyhole size={20} aria-hidden="true" /></span>
        <div>
          <strong>{lockedTitle ?? `${kindLabel} locked`}</strong>
          <p>{lockedMessage ?? "This evidence is attached to a saved customer signature and cannot be changed."}</p>
        </div>
      </section>
    );
  }

  return (
    <form className={styles.uploader} onSubmit={(event) => void submit(event)}>
      <div className={styles.captureControl}>
        <input
          ref={inputRef}
          id={inputId}
          className={styles.fileInput}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(event) => void handleFile(event.target.files?.[0])}
        />
        <label className={styles.captureButton} htmlFor={inputId}>
          {file ? <ImagePlus size={24} aria-hidden="true" /> : <Camera size={24} aria-hidden="true" />}
          <span><strong>{processing ? "Preparing photo…" : file ? "Choose a different photo" : "Take or choose photo"}</strong></span>
        </label>
      </div>

      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {saved ? <p className={styles.saved} role="status"><Check size={17} aria-hidden="true" />Photo saved</p> : null}

      {dataUrl ? (
        <div className={styles.selection}>
          <div className={styles.previewWrap}>
            <img className={styles.preview} src={dataUrl} alt="Selected job photo preview" />
            <button className={styles.removeSelection} type="button" onClick={clearSelection} aria-label="Remove selected photo">
              <X size={18} aria-hidden="true" />
            </button>
          </div>

          <div className={styles.details}>
            {lockedKind ? (
              <div className={styles.lockedKind}>
                <span>Photo type</span>
                <strong>{lockedKind === "before" ? "Before work" : lockedKind === "after" ? "After work" : "Job proof"}</strong>
              </div>
            ) : (
              <fieldset className={styles.kindControl}>
                <legend>Photo type</legend>
                <div>
                  {photoKinds.map((option) => (
                    <button
                      key={option}
                      type="button"
                      className={kind === option ? styles.kindActive : undefined}
                      aria-pressed={kind === option}
                      onClick={() => setKind(option)}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </fieldset>
            )}

            <label className={styles.caption}>
              <span>Caption <small>optional</small></span>
              <input
                value={caption}
                onChange={(event) => setCaption(event.target.value)}
                placeholder="Leak location, serial number, completed repair…"
              />
            </label>

            <button className={styles.saveButton} type="submit" disabled={processing || saving}>
              <Check size={19} aria-hidden="true" />
              {saving ? (demoMode ? "Saving…" : "Uploading…") : demoMode ? "Save photo" : "Upload photo"}
            </button>
            {demoMode ? null : <p className={styles.privateNote}>Photos are stored privately with this job.</p>}
          </div>
        </div>
      ) : null}
    </form>
  );
}
