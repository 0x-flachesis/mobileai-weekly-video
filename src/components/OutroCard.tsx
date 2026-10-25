import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import type { OutroSegment as OutroSegmentData } from "../../scripts/lib/storyboard";
import { EASE_OUT, fontFamily, size, theme } from "../theme";

/** 結尾卡：本週標題列表逐條淡入 → 大網址定版 → CTA。 */
export const OutroCard: React.FC<{ seg: OutroSegmentData }> = ({ seg }) => {
  const frame = useCurrentFrame();

  const siteScale = interpolate(frame, [6, 26], [0.94, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });
  const siteOpacity = interpolate(frame, [6, 22], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });
  const ctaOpacity = interpolate(frame, [40, 54], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });

  const visible = Math.min(seg.headlines.length, 5);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: theme.ink,
        fontFamily,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 44,
      }}
    >
      <div
        style={{
          opacity: siteOpacity,
          transform: `scale(${siteScale})`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 18,
        }}
      >
        <div
          style={{
            color: theme.accentSoft,
            fontSize: size.body,
            fontWeight: 500,
            letterSpacing: "0.24em",
          }}
        >
          本週速覽 · {seg.headlines.length} 篇
        </div>
        <div
          style={{
            color: "#ffffff",
            fontSize: 96,
            fontWeight: 900,
            letterSpacing: "0.01em",
          }}
        >
          {seg.site}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 14,
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 860 }}>
          {seg.headlines.slice(0, visible).map((h, i) => {
            const start = 18 + i * 7;
            const opacity = interpolate(frame, [start, start + 12], [0, 0.92], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: EASE_OUT,
            });
            const x = interpolate(frame, [start, start + 14], [-28, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: EASE_OUT,
            });
            return (
              <div
                key={i}
                style={{
                  opacity,
                  transform: `translateX(${x}px)`,
                  color: "#dfe5ea",
                  fontSize: size.caption,
                  fontWeight: 500,
                  display: "flex",
                  alignItems: "baseline",
                  gap: 20,
                }}
              >
                <span style={{ color: "#7fa8c7", fontWeight: 700, width: 44, flexShrink: 0 }}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span
                  style={{
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                    textOverflow: "ellipsis",
                    maxWidth: 780,
                  }}
                >
                  {h}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div
        style={{
          opacity: ctaOpacity,
          color: theme.accentSoft,
          fontSize: size.body,
          fontWeight: 700,
          padding: "14px 40px",
          border: `2px solid ${theme.accent}`,
          borderRadius: 999,
          letterSpacing: "0.1em",
        }}
      >
        每週一更新 · 完整內容詳見網站
      </div>
    </AbsoluteFill>
  );
};
