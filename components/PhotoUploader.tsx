"use client";

import { Camera, Check, ImagePlus, X } from "lucide-react";
import { useId, useRef, useState } from "react";
import { photoKinds, useAppData } from "@/lib/data-store";
import { demoMode } from "@/lib/runtime";
import type { PhotoKind } from "@/lib/types";
import styles from "./PhotoUploader.module.css";

export function PhotoUploader({ jobId, uploadedBy }: { jobId: string; uploadedBy: string }) {
  const data = useAppData();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<PhotoKind>("before");
  const [caption, setCaption] = useState("");
  const [fileName, setFileName] = useState("");
  const [dataUrl, setDataUrl] = useState("");
  const [file, setFile] = useState<File | undefined>();

  function handleFile(nextFile: File | undefined) {
    if (!nextFile) return;
    setFile(nextFile);
    setFileName(nextFile.name);

    const reader = new FileReader();
    reader.onload = () => setDataUrl(String(reader.result));
    reader.readAsDataURL(nextFile);
  }

  function clearSelection() {
    setFile(undefined);
    setFileName("");
    setDataUrl("");
    if (inputRef.current) inputRef.current.value = "";
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!file || !dataUrl) return;
    data.addPhoto({
      jobId,
      uploadedBy,
      kind,
      caption: caption.trim() || fileName || undefined,
      storagePath: dataUrl || `${jobId}/${Date.now()}_${fileName || "photo.jpg"}`,
      file
    });
    setCaption("");
    setKind("before");
    clearSelection();
  }

  return (
    <form className={styles.uploader} onSubmit={submit}>
      <div className={styles.captureControl}>
        <input
          ref={inputRef}
          id={inputId}
          className={styles.fileInput}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(event) => handleFile(event.target.files?.[0])}
        />
        <label className={styles.captureButton} htmlFor={inputId}>
          {file ? <ImagePlus size={24} aria-hidden="true" /> : <Camera size={24} aria-hidden="true" />}
          <span>
            <strong>{file ? "Choose a different photo" : "Take or choose a photo"}</strong>
            <small>{file ? fileName : "Opens the camera on iPad and the photo picker on a computer"}</small>
          </span>
        </label>
      </div>

      {dataUrl ? (
        <div className={styles.selection}>
          <div className={styles.previewWrap}>
            <img className={styles.preview} src={dataUrl} alt="Selected job photo preview" />
            <button className={styles.removeSelection} type="button" onClick={clearSelection} aria-label="Remove selected photo">
              <X size={18} aria-hidden="true" />
            </button>
          </div>

          <div className={styles.details}>
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

            <label className={styles.caption}>
              <span>Caption <small>optional</small></span>
              <input
                value={caption}
                onChange={(event) => setCaption(event.target.value)}
                placeholder="Leak location, serial number, completed repair…"
              />
            </label>

            <button className={styles.saveButton} type="submit">
              <Check size={19} aria-hidden="true" />
              {demoMode ? "Save photo" : "Upload photo"}
            </button>
            {demoMode ? null : <p className={styles.privateNote}>Photos are stored privately with this job.</p>}
          </div>
        </div>
      ) : null}
    </form>
  );
}
