import React from "react";
import { Composition, registerRoot } from "remotion";
import { FPS, HEIGHT, WIDTH, type Storyboard } from "../scripts/lib/storyboard";
import { WeeklyRecap } from "./WeeklyRecap";
import sample from "./sample-storyboard.json";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="WeeklyRecap"
      component={WeeklyRecap}
      durationInFrames={sample.totalFrames}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      defaultProps={{ storyboard: sample as Storyboard }}
      calculateMetadata={({ props }) => ({
        durationInFrames: props.storyboard.totalFrames,
      })}
    />
  );
};

registerRoot(RemotionRoot);
