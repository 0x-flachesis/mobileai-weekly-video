import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { Storyboard } from "../scripts/lib/storyboard";
import { ArticleSegment } from "./components/ArticleSegment";
import { OutroCard } from "./components/OutroCard";
import { TitleCard } from "./components/TitleCard";
import { loadFonts } from "./load-font";
import { fontFamily } from "./theme";

/** SFX 長度（frames）：whoosh 長、impact 短、riser 前導。 */
const SFX_DUR: Record<string, number> = { whoosh: 40, impact: 36, riser: 55 };

/** 語音相對段落起點延遲（與字幕 leadIn=6 對齊）。 */
const VOICE_LEAD_IN = 6;

export const WeeklyRecap: React.FC<{ storyboard: Storyboard }> = ({ storyboard }) => {
  loadFonts();
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const { bgm, segments, sfx, seed } = storyboard;

  // BGM：1s 淡入至 0.34，結尾 fadeOutFrames 淡出（保留 headroom 給旁白）
  const bgmVolume = (f: number) => {
    if (f < 30) return (bgm.volume * f) / 30;
    const fadeStart = durationInFrames - bgm.fadeOutFrames;
    if (f > fadeStart) {
      return (bgm.volume * (durationInFrames - f)) / bgm.fadeOutFrames;
    }
    return bgm.volume;
  };

  return (
    <AbsoluteFill style={{ backgroundColor: "#000000", fontFamily }}>
      {segments.map((seg, i) => (
        <Sequence
          key={`${seg.kind}-${i}`}
          from={seg.from}
          durationInFrames={seg.duration}
          name={seg.kind === "article" ? `Article ${seg.index + 1}` : seg.kind}
        >
          {seg.kind === "intro" ? (
            <TitleCard seg={seg} />
          ) : seg.kind === "article" ? (
            <ArticleSegment seg={seg} seed={seed} />
          ) : (
            <OutroCard seg={seg} />
          )}
          {seg.audio ? (
            <Sequence from={VOICE_LEAD_IN} durationInFrames={seg.duration}>
              <Audio src={staticFile(seg.audio)} volume={1} />
            </Sequence>
          ) : null}
        </Sequence>
      ))}

      <Audio src={staticFile(bgm.src)} volume={bgmVolume} />

      {sfx.map((pin, i) => (
        <Sequence key={`sfx-${i}`} from={pin.atFrame} durationInFrames={SFX_DUR[pin.name] ?? 30}>
          <Audio src={staticFile(`sfx/${pin.name}.mp3`)} volume={pin.volume} />
        </Sequence>
      ))}

      {/* 片尾黑幕淡出 */}
      <AbsoluteFill
        style={{
          backgroundColor: "#000000",
          opacity: frame > durationInFrames - 15 ? (frame - (durationInFrames - 15)) / 15 : 0,
        }}
      />
    </AbsoluteFill>
  );
};
