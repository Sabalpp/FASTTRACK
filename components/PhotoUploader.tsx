"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Field, TwoColumn } from "@/components/ui";
import { photoKinds, useAppData } from "@/lib/data-store";
import { demoMode } from "@/lib/runtime";
import type { PhotoKind } from "@/lib/types";

export function PhotoUploader({ jobId, uploadedBy }: { jobId: string; uploadedBy: string }) {
  const data = useAppData();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [kind, setKind] = useState<PhotoKind>("before");
  const [caption, setCaption] = useState("");
  const [fileName, setFileName] = useState("");
  const [dataUrl, setDataUrl] = useState("");
  const [file, setFile] = useState<File | undefined>();
  const [previewUrl, setPreviewUrl] = useState("");
  const [cameraSupported, setCameraSupported] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState("");

  useEffect(() => {
    setCameraSupported(Boolean(navigator.mediaDevices?.getUserMedia));
    return () => stopCamera();
  }, []);

  function handleFile(file: File | undefined) {
    if (!file) return;
    setFile(file);
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      setDataUrl(result);
      setPreviewUrl(result);
    };
    reader.readAsDataURL(file);
  }

  async function startCamera() {
    setCameraError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Camera access is not available in this browser.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false
      });
      streamRef.current = stream;
      setCameraActive(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch {
      setCameraError("Camera permission was blocked or no camera was found.");
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
  }

  function captureCameraPhoto() {
    const video = videoRef.current;
    if (!video) return;
    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(video, 0, 0, width, height);
    const nextDataUrl = canvas.toDataURL("image/jpeg", 0.88);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const capturedFile = new File([blob], `job-photo-${Date.now()}.jpg`, { type: "image/jpeg" });
      setFile(capturedFile);
      setFileName(capturedFile.name);
      setDataUrl(nextDataUrl);
      setPreviewUrl(nextDataUrl);
      stopCamera();
    }, "image/jpeg", 0.88);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!file && !dataUrl) return;
    data.addPhoto({
      jobId,
      uploadedBy,
      kind,
      caption: caption.trim() || fileName || undefined,
      storagePath: dataUrl || `${jobId}/${Date.now()}_${fileName || "placeholder.jpg"}`,
      file
    });
    setCaption("");
    setFileName("");
    setDataUrl("");
    setPreviewUrl("");
    setFile(undefined);
  }

  return (
    <form className="stack" onSubmit={submit}>
      <TwoColumn>
        <Field label="Photo kind">
          <div className="segmented-control photo-kind-segments">
            {photoKinds.map((option) => (
              <button
                key={option}
                type="button"
                className={kind === option ? "active" : ""}
                onClick={() => setKind(option)}
              >
                {option}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Choose photo">
          <input type="file" accept="image/*" capture="environment" onChange={(event) => handleFile(event.target.files?.[0])} />
        </Field>
      </TwoColumn>
      <div className="camera-capture-panel">
        <div className="camera-actions">
          <Button type="button" variant="secondary" onClick={cameraActive ? stopCamera : startCamera} disabled={!cameraSupported}>
            {cameraActive ? "Close camera" : "Use device camera"}
          </Button>
          {cameraActive ? <Button type="button" onClick={captureCameraPhoto}>Capture photo</Button> : null}
        </div>
        <video ref={videoRef} className={`camera-video ${cameraActive ? "camera-video-active" : ""}`} playsInline muted autoPlay />
        {previewUrl ? <img className="photo-preview" src={previewUrl} alt="Selected job photo preview" /> : null}
        {cameraError ? <p className="error-message">{cameraError}</p> : null}
        <p className="muted small">On phones and iPads, Choose photo can open the camera. Use device camera captures directly when supported.</p>
      </div>
      <Field label="Caption">
        <input value={caption} onChange={(event) => setCaption(event.target.value)} placeholder="Before, after, serial number, leak location..." />
      </Field>
      <Button type="submit" disabled={!file && !dataUrl}>{demoMode ? "Add photo" : "Upload private photo"}</Button>
      {demoMode ? null : <p className="muted small">Production mode stores photos in the private Supabase bucket.</p>}
    </form>
  );
}
