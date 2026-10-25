import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import type { IntroSegment } from "../../scripts/lib/storyboard";
import { EASE_OUT, ENTER_FRAMES, fontFamily, size, theme } from "../theme";

/**
 * 開場卡：左側強調色横條掃入 → 大標題 clip-reveal 上滑 → 日期/篇數資訊淡入 → 定版不動（lockup ≥1s）。
 * 一鏡一效果原則：主效果為標題上滑；色條與資訊為次級淡入。
 */
export const TitleCard: React.FC<{ seg: IntroSegment }> = ({ seg }) => {
  const frame = useCurrentFrame();

  const barScale = interpolate(frame, [0, 14], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });
  const titleY = interpolate(frame, [10, 10 + ENTER_FRAMES], [72, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });
  const titleClip = interpolate(frame, [10, 10 + ENTER_FRAMES + 4], [100, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });
  const metaOpacity = interpolate(frame, [26, 40], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });

  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg, fontFamily }}>
      {/* 細網格質感 */}
      <AbsoluteFill
        style={{
          backgroundImage: `linear-gradient(${theme.line} 1px, transparent 1px), linear-gradient(90deg, ${theme.line} 1px, transparent 1px)`,
          backgroundSize: "120px 120px",
          opacity: 0.35,
        }}
      />
      {/* 強調色條 */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: "22%",
          height: 300,
          width: 26,
          backgroundColor: theme.accent,
          transformOrigin: "top center",
          transform: `scaleY(${barScale})`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 110,
          top: "24%",
          display: "flex",
          flexDirection: "column",
          gap: 26,
        }}
      >
        <div style={{ overflow: "hidden", height: size.display * 1.16 }}>
          <div
            style={{
              fontSize: size.display,
              fontWeight: 900,
              color: theme.ink,
              lineHeight: 1.12,
              transform: `translateY(${titleY}px)`,
              clipPath: `inset(${titleClip}% 0 0 0)`,
              letterSpacing: "0.01em",
            }}
          >
            {seg.title}
          </div>
        </div>
        <div
          style={{
            opacity: metaOpacity,
            display: "flex",
            alignItems: "center",
            gap: 24,
            color: theme.inkSoft,
            fontSize: size.body,
            fontWeight: 500,
          }}
        >
          <span
            style={{
              backgroundColor: theme.accentSoft,
              color: theme.accentDeep,
              padding: "8px 22px",
              borderRadius: 999,
              fontWeight: 700,
            }}
          >
            {seg.dateLabel}
          </span>
          <span>本週 {seg.articleCount} 篇新內容</span>
        </div>
      </div>
    </AbsoluteFill>
  );
};
