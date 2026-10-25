import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { wrapHeadline, type ArticleSegment as ArticleSegmentData } from "../../scripts/lib/storyboard";
import { Captions, LowerThird } from "./Captions";
import { KenBurns } from "./KenBurns";
import { EASE_OUT, ENTER_FRAMES, STAGGER, fontFamily, size, theme } from "../theme";

/**
 * 文章段：左圖（KenBurns 全程運鏡）+ 右側文字（tag 膠囊 → 短標逐行上滑 → 來源）。
 * 主效果＝短標上滑（一鏡一效果）；字幕與 lower-third 為資訊層。
 */
export const ArticleSegment: React.FC<{ seg: ArticleSegmentData; seed: number }> = ({ seg, seed }) => {
  const frame = useCurrentFrame();

  const imgSlide = interpolate(frame, [0, 18], [-64, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });
  const imgOpacity = interpolate(frame, [0, 14], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });

  const tagOpacity = interpolate(frame, [8, 8 + 14], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });
  const badgeOpacity = interpolate(frame, [16, 16 + 14], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });

  const headlineLines = wrapHeadline(seg.headline, 7);  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg, fontFamily }}>
      {/* 左：圖片卡（下緣預留字幕藥丸空間） */}
      <div
        style={{
          position: "absolute",
          left: 72,
          top: 120,
          bottom: 216,
          width: 800,
          opacity: imgOpacity,
          transform: `translateX(${imgSlide}px)`,
        }}
      >
        <KenBurns image={seg.image} spec={seg.kenburns} seed={seed + seg.index * 13} />
        <div
          style={{
            position: "absolute",
            top: 26,
            left: 26,
            opacity: badgeOpacity,
            backgroundColor: "rgba(20, 23, 26, 0.78)",
            color: "#fff",
            fontFamily,
            fontSize: size.caption,
            fontWeight: 700,
            padding: "6px 18px",
            borderRadius: 12,
          }}
        >
          {String(seg.index + 1).padStart(2, "0")}
        </div>
      </div>

      {/* 右：文字 */}
      <div
        style={{
          position: "absolute",
          left: 940,
          right: 84,
          top: 0,
          bottom: 0,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 30,
        }}
      >
        <div
          style={{
            opacity: tagOpacity,
            alignSelf: "flex-start",
            backgroundColor: theme.accent,
            color: "#fff",
            fontSize: size.caption,
            fontWeight: 700,
            padding: "8px 24px",
            borderRadius: 999,
            letterSpacing: "0.08em",
          }}
        >
          {seg.tag}
        </div>
        {headlineLines.map((line, li) => {
          const start = 14 + li * STAGGER;
          const y = interpolate(frame, [start, start + ENTER_FRAMES], [48, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: EASE_OUT,
          });
          const clip = interpolate(frame, [start, start + ENTER_FRAMES + 3], [100, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: EASE_OUT,
          });
          return (
            <div key={li} style={{ overflow: "hidden" }}>
              <div
                style={{
                  fontSize: headlineLines.length > 2 ? size.headlineSmall : size.headline,
                  fontWeight: 900,
                  color: theme.ink,
                  lineHeight: 1.22,
                  transform: `translateY(${y}px)`,
                  clipPath: `inset(${clip}% 0 0 0)`,
                }}
              >
                {line}
              </div>
            </div>
          );
        })}
        <div
          style={{
            marginTop: 8,
            width: 120,
            height: 6,
            backgroundColor: theme.accent,
            borderRadius: 3,
            opacity: interpolate(frame, [14 + headlineLines.length * STAGGER, 14 + headlineLines.length * STAGGER + 12], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        />
      </div>

      <Captions cues={seg.captions} />
      <LowerThird text={seg.link.replace("https://", "").replace(/\/$/, "")} />
    </AbsoluteFill>
  );
}
