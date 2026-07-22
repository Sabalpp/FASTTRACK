"use client";

import { Camera, CameraOff, Check, ImagePlus, LockKeyhole, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { photoKinds, useAppData } from "@/lib/data-store";
import { createPhotoPreview } from "@/lib/photo-preview";
import { MAX_JOB_PHOTO_CAPTION_LENGTH, MAX_JOB_PHOTO_UPLOAD_BYTES, normalizeJobPhotoCaption } from "@/lib/job-photos";
import { demoMode } from "@/lib/runtime";
import type { PhotoKind } from "@/lib/types";
import styles from "./PhotoUploader.module.css";

export function PhotoUploader({
  jobId,
  uploadedBy,
  lockedKind,
  checkpointLocked = false,
  lockedTitle,
  lockedMessage,
  checkpointSkipped = false,
  checkpointSkipSummary,
  onSkipCheckpoint,
  skipDisabled = false,
  skipDisabledMessage
}: {
  jobId: string;
  uploadedBy: string;
  lockedKind?: PhotoKind;
  checkpointLocked?: boolean;
  lockedTitle?: string;
  lockedMessage?: string;
  checkpointSkipped?: boolean;
  checkpointSkipSummary?: string;
  onSkipCheckpoint?: () => Promise<void>;
  skipDisabled?: boolean;
  skipDisabledMessage?: string;
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
  const [confirmingSkip, setConfirmingSkip] = useState(false);
  const [skipBusy, setSkipBusy] = useState(false);
  const [skipError, setSkipError] = useState<string | undefined>();

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

  useEffect(() => {
    setConfirmingSkip(false);
    setSkipBusy(false);
    setSkipError(undefined);
  }, [checkpointLocked, checkpointSkipped, jobId, lockedKind]);

  async function handleFile(nextFile: File | undefined) {
    if (!nextFile) return;
    setFile(nextFile);
    setFileName(nextFile.name);
    setProcessing(true);
    setSaved(false);
    setError(undefined);
    try {
      const preview = await createPhotoPreview(nextFile);
      const preparedFile = jpegFileFromPreview(preview, nextFile);
      if (preparedFile.size > MAX_JOB_PHOTO_UPLOAD_BYTES) {
        throw new Error("This photo is larger than 12 MB after preparation. Choose a smaller image or take a screenshot and upload it.");
      }
      setDataUrl(preview);
      setFile(preparedFile);
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
        caption: normalizeJobPhotoCaption(caption || fileName),
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

  async function confirmSkip() {
    if (!onSkipCheckpoint || checkpointLocked || checkpointSkipped || skipDisabled || skipBusy || file || processing || saving) return;
    setSkipBusy(true);
    setSkipError(undefined);
    try {
      await onSkipCheckpoint();
      setConfirmingSkip(false);
    } catch (skipFailure) {
      setSkipError(skipFailure instanceof Error ? skipFailure.message : "The photo checkpoint could not be skipped.");
    } finally {
      setSkipBusy(false);
    }
  }

  const checkpointName = lockedKind === "after" ? "after" : "before";
  const checkpointTitle = lockedKind === "after" ? "After photo" : "Before photo";

  if (checkpointSkipped) {
    return (
      <section className={styles.skippedState} role="status" aria-label={`${checkpointTitle} skipped`}>
        <span><CameraOff size={20} aria-hidden="true" /></span>
        <div>
          <strong>{checkpointTitle} explicitly skipped</strong>
          <p>{checkpointSkipSummary ?? "The technician chose to continue without this photo. The choice is saved in the job audit record."}</p>
        </div>
      </section>
    );
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

      {onSkipCheckpoint ? (
        <section className={styles.skipPanel} aria-label={`Optional ${checkpointName} photo`}>
          {confirmingSkip ? (
            <div className={styles.skipPrompt} role="group" aria-label={`Confirm skip ${checkpointName} photo`}>
              <div>
                <strong>Continue without a {checkpointName} photo?</strong>
                <span>This cannot be undone from the job. Your identity and the time are saved in the audit record.</span>
              </div>
              <div className={styles.skipActions}>
                <button type="button" className={styles.skipCancel} onClick={() => setConfirmingSkip(false)} disabled={skipBusy}>Keep photo step</button>
                <button type="button" className={styles.skipConfirm} onClick={() => void confirmSkip()} disabled={skipBusy}>
                  {skipBusy ? "Recording…" : "Confirm skip"}
                </button>
              </div>
            </div>
          ) : (
            <div className={styles.skipOffer}>
              <div><strong>Photo unavailable?</strong><span>You can explicitly skip this checkpoint and keep the audit trail.</span></div>
              <button
                type="button"
                className={styles.skipButton}
                onClick={() => {
                  setSkipError(undefined);
                  setConfirmingSkip(true);
                }}
                disabled={skipDisabled || Boolean(file) || processing || saving}
              >
                Skip {checkpointName} photo
              </button>
            </div>
          )}
          {skipDisabledMessage && !confirmingSkip ? <p className={styles.skipNote}>{skipDisabledMessage}</p> : null}
          {skipError ? <p className={styles.error} role="alert">{skipError}</p> : null}
        </section>
      ) : null}

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
                maxLength={MAX_JOB_PHOTO_CAPTION_LENGTH}
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

function jpegFileFromPreview(dataUrl: string, original: File): File {
  const match = dataUrl.match(/^data:image\/jpeg(?:;[^,]*)?;base64,(.+)$/i);
  if (!match) {
    if (/^image\/(jpe?g|png)$/i.test(original.type)) return original;
    throw new Error("This camera photo could not be converted to JPEG. Choose a JPG or PNG image, or take a screenshot and upload it.");
  }

  try {
    const binary = atob(match[1]);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const baseName = original.name.replace(/\.[^.]+$/, "").trim() || "job-photo";
    return new File([bytes], `${baseName}.jpg`, {
      type: "image/jpeg",
      lastModified: original.lastModified
    });
  } catch {
    return original;
  }
}
