import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import type { Caption } from "../../scripts/lib/storyboard";
import { EASE_OUT, fontFamily, size, theme } from "../theme";

/** 底部字幕：深色藥丸底 + 白字，4f 淡入淡出。一次只顯示一條 cue。 */
export const Captions: React.FC<{ cues: Caption[] }> = ({ cues }) => {
  const frame = useCurrentFrame();
  const active = cues.find((c) => frame >= c.from && frame < c.from + c.duration);
  if (!active) return null;
  const local = frame - active.from;
  const opacity = interpolate(
    local,
    [0, 4, active.duration - 4, active.duration],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 84,
        display: "flex",
        justifyContent: "center",
        opacity,
      }}
    >
      <div
        style={{
          background: "rgba(20, 23, 26, 0.82)",
          color: "#ffffff",
          fontFamily,
          fontSize: size.body,
          fontWeight: 500,
          lineHeight: 1.5,
          padding: "14px 34px",
          borderRadius: 999,
          letterSpacing: "0.02em",
        }}
      >
        {active.text}
      </div>
    </div>
  );
};

/** 來源標示（lower-third）：小字網址，出場淡入後常駐。 */
export const LowerThird: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [8, 20], [0, 0.85], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });
  return (
    <div
      style={{
        position: "absolute",
        left: 96,
        bottom: 40,
        opacity,
        fontFamily,
        fontSize: size.tiny,
        color: theme.inkFaint,
        letterSpacing: "0.04em",
      }}
    >
      {text}
    </div>
  );
};
