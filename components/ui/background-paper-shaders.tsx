"use client";

import { useEffect, useRef, useState } from "react";
import { DotOrbit, MeshGradient } from "@paper-design/shaders-react";

export function BackgroundPaperShaders() {
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const [isInteracting, setIsInteracting] = useState(false);
  const resetTimer = useRef<number | undefined>(undefined);
  const frame = useRef<number | undefined>(undefined);
  const idleFrame = useRef<number | undefined>(undefined);
  const lastPointerAt = useRef(0);

  const speed = isInteracting ? 1.45 : 0.88;
  const dotSpeed = isInteracting ? 1.9 : 1.08;

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      lastPointerAt.current = performance.now();
      if (frame.current) window.cancelAnimationFrame(frame.current);

      frame.current = window.requestAnimationFrame(() => {
        setPointer({
          x: (event.clientX / window.innerWidth - 0.5) * 0.34,
          y: (event.clientY / window.innerHeight - 0.5) * -0.28
        });
        setIsInteracting(true);
      });

      if (resetTimer.current) window.clearTimeout(resetTimer.current);
      resetTimer.current = window.setTimeout(() => {
        setIsInteracting(false);
      }, 900);
    }

    function animateIdle() {
      const now = performance.now();
      if (now - lastPointerAt.current > 900) {
        const t = now / 1000;
        setPointer({
          x: Math.sin(t * 0.38) * 0.055,
          y: Math.cos(t * 0.31) * 0.045
        });
      }
      idleFrame.current = window.setTimeout(animateIdle, 80);
    }

    window.addEventListener("pointermove", handlePointerMove, { capture: true, passive: true });
    idleFrame.current = window.setTimeout(animateIdle, 80);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove, { capture: true });
      if (resetTimer.current) window.clearTimeout(resetTimer.current);
      if (frame.current) window.cancelAnimationFrame(frame.current);
      if (idleFrame.current) window.clearTimeout(idleFrame.current);
    };
  }, []);

  return (
    <div className="paper-shader-background" aria-hidden="true">
      <MeshGradient
        className="paper-mesh-gradient"
        colors={["#000000", "#0b111b", "#1a1a1a", "#333333", "#ffffff"]}
        distortion={0.82}
        swirl={0.58}
        grainMixer={0.18}
        grainOverlay={0.1}
        speed={speed}
        fit="cover"
        scale={1.2}
        offsetX={pointer.x}
        offsetY={pointer.y}
      />
      <DotOrbit
        className="paper-dot-orbit"
        colorBack="#000000"
        colors={["#111827", "#333333", "#ffffff", "#c45d2a"]}
        speed={dotSpeed}
        fit="cover"
        scale={0.34}
        size={0.26}
        sizeRange={0.52}
        spreading={0.44}
        stepsPerColor={2}
        offsetX={pointer.x * -0.7}
        offsetY={pointer.y * -0.7}
      />
      <div className="paper-shader-lighting" />
    </div>
  );
}
