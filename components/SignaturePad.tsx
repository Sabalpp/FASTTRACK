"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

type SignaturePoint = { x: number; y: number; pressure: number };
type SignatureStroke = { points: SignaturePoint[]; pointerType: string };

export type SignaturePadHandle = {
  clear: () => void;
  undo: () => void;
  isEmpty: () => boolean;
  exportPng: () => Promise<{ blob: Blob; width: number; height: number }>;
};

export const SignaturePad = forwardRef<SignaturePadHandle, {
  onStrokeCountChange?: (count: number) => void;
}>(function SignaturePad({ onStrokeCountChange }, ref) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const strokesRef = useRef<SignatureStroke[]>([]);
  const activeStrokeRef = useRef<SignatureStroke | null>(null);
  const [strokeCount, setStrokeCount] = useState(0);

  function publishCount() {
    const count = strokesRef.current.length;
    setStrokeCount(count);
    onStrokeCountChange?.(count);
  }

  function redraw() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(rect.width * ratio));
    const height = Math.max(1, Math.round(rect.height * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    context.clearRect(0, 0, canvas.width, canvas.height);
    drawStrokes(context, strokesRef.current, canvas.width, canvas.height, ratio);
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(redraw);
    observer.observe(canvas);
    redraw();
    return () => observer.disconnect();
  }, []);

  useImperativeHandle(ref, () => ({
    clear() {
      strokesRef.current = [];
      activeStrokeRef.current = null;
      publishCount();
      redraw();
    },
    undo() {
      strokesRef.current = strokesRef.current.slice(0, -1);
      activeStrokeRef.current = null;
      publishCount();
      redraw();
    },
    isEmpty() {
      return strokesRef.current.length === 0;
    },
    exportPng() {
      return exportSignature(strokesRef.current);
    }
  }));

  function pointForEvent(event: React.PointerEvent<HTMLCanvasElement>): SignaturePoint {
    const canvas = event.currentTarget;
    const bounds = canvas.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
      y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
      pressure: event.pressure > 0 ? event.pressure : event.pointerType === "mouse" ? 0.5 : 0.35
    };
  }

  function startStroke(event: React.PointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const stroke: SignatureStroke = { points: [pointForEvent(event)], pointerType: event.pointerType };
    strokesRef.current = [...strokesRef.current, stroke];
    activeStrokeRef.current = stroke;
    publishCount();
    redraw();
  }

  function continueStroke(event: React.PointerEvent<HTMLCanvasElement>) {
    const activeStroke = activeStrokeRef.current;
    if (!activeStroke || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.preventDefault();
    const events = typeof event.nativeEvent.getCoalescedEvents === "function"
      ? event.nativeEvent.getCoalescedEvents()
      : [event.nativeEvent];
    const bounds = event.currentTarget.getBoundingClientRect();
    for (const pointEvent of events) {
      activeStroke.points.push({
        x: Math.min(1, Math.max(0, (pointEvent.clientX - bounds.left) / bounds.width)),
        y: Math.min(1, Math.max(0, (pointEvent.clientY - bounds.top) / bounds.height)),
        pressure: pointEvent.pressure > 0 ? pointEvent.pressure : event.pointerType === "mouse" ? 0.5 : 0.35
      });
    }
    redraw();
  }

  function finishStroke(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!activeStrokeRef.current) return;
    event.preventDefault();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    activeStrokeRef.current = null;
    redraw();
  }

  return (
    <div className="signature-pad-shell">
      <canvas
        ref={canvasRef}
        className="signature-pad-canvas"
        aria-label="Signature drawing area"
        onPointerDown={startStroke}
        onPointerMove={continueStroke}
        onPointerUp={finishStroke}
        onPointerCancel={finishStroke}
        onContextMenu={(event) => event.preventDefault()}
      />
      <span className="signature-pad-line" aria-hidden="true" />
      <span className="signature-pad-hint">Sign above · touch, stylus, mouse, or trackpad</span>
      <span className="sr-only" aria-live="polite">{strokeCount > 0 ? "Signature in progress" : "Signature pad is empty"}</span>
    </div>
  );
});

function drawStrokes(
  context: CanvasRenderingContext2D,
  strokes: SignatureStroke[],
  width: number,
  height: number,
  pixelRatio: number
) {
  context.strokeStyle = "#102a36";
  context.fillStyle = "#102a36";
  context.lineCap = "round";
  context.lineJoin = "round";

  for (const stroke of strokes) {
    if (stroke.points.length === 1) {
      const point = stroke.points[0];
      context.beginPath();
      context.arc(point.x * width, point.y * height, 1.8 * pixelRatio, 0, Math.PI * 2);
      context.fill();
      continue;
    }
    for (let index = 1; index < stroke.points.length; index += 1) {
      const previous = stroke.points[index - 1];
      const current = stroke.points[index];
      const pressure = Math.max(0.25, (previous.pressure + current.pressure) / 2);
      context.lineWidth = (stroke.pointerType === "pen" ? 2 + pressure * 2.7 : 2.5) * pixelRatio;
      context.beginPath();
      context.moveTo(previous.x * width, previous.y * height);
      context.lineTo(current.x * width, current.y * height);
      context.stroke();
    }
  }
}

async function exportSignature(strokes: SignatureStroke[]) {
  if (strokes.length === 0) throw new Error("Draw a signature before saving.");
  const width = 1600;
  const height = 600;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The signature image could not be prepared.");
  drawStrokes(context, strokes, width, height, 2);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("The signature image could not be prepared.");
  return { blob, width, height };
}
