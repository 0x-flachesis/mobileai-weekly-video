import React from "react";
import { AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { KenBurnsSpec } from "../../scripts/lib/storyboard";
import { theme } from "../theme";

/** KenBurns 運鏡容器：內部圖片全程連續 scale/pan（線性），外框圓角裁切。 */
export const KenBurns: React.FC<{
  image?: string;
  spec: KenBurnsSpec;
  seed: number;
  radius?: number;
}> = ({ image, spec, seed, radius = 28 }) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();

  const scale = (f: number) =>
    f === durationInFrames
      ? spec.toScale
      : spec.fromScale + ((spec.toScale - spec.fromScale) * f) / durationInFrames;
  const lerp = (a: number, b: number, f: number) => a + ((b - a) * f) / durationInFrames;

  const s = scale(frame);
  const tx = lerp(spec.fromX, spec.toX, frame) * width * 0.04;
  const ty = lerp(spec.fromY, spec.toY, frame) * height * 0.04;

  if (!image) {
    // 無圖 fallback：主題色漸層 + 大編號裝飾
    const angle = (seed % 4) * 90;
    return (
      <AbsoluteFill
        style={{
          borderRadius: radius,
          overflow: "hidden",
          background: `linear-gradient(${angle}deg, ${theme.accentDeep} 0%, ${theme.accent} 55%, ${theme.accentSoft} 100%)`,
        }}
      />
    );
  }
  return (
    <AbsoluteFill style={{ borderRadius: radius, overflow: "hidden", backgroundColor: theme.line }}>
      <Img
        src={staticFile(image)}
        style={{
          position: "absolute",
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${s}) translate(${tx}px, ${ty}px)`,
          transformOrigin: "center center",
        }}
      />
    </AbsoluteFill>
  );
};
