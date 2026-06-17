"use client";

import { useState } from "react";
import { DotOrbit, MeshGradient } from "@paper-design/shaders-react";

export function BackgroundPaperShaders() {
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const [isInteracting, setIsInteracting] = useState(false);

  const speed = isInteracting ? 1.35 : 0.72;
  const dotSpeed = isInteracting ? 1.8 : 0.95;

  return (
    <div
      className="paper-shader-background"
      aria-hidden="true"
      onPointerMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        setPointer({
          x: ((event.clientX - rect.left) / rect.width - 0.5) * 0.34,
          y: ((event.clientY - rect.top) / rect.height - 0.5) * -0.28
        });
        setIsInteracting(true);
      }}
      onPointerLeave={() => {
        setPointer({ x: 0, y: 0 });
        setIsInteracting(false);
      }}
    >
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
