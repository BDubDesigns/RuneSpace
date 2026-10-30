import { useId, type CSSProperties } from "react";
import { RESONANCE_RIG_CUE_ANCHORS } from "@/game/content/scene-cues";
import { sceneCueLayerStyle, type SceneCueState } from "@/game/domain/scene-cues";

/**
 * The stage-relative layers a scene cue sequence animates (#441): the Rig's Core
 * glow and the rift. They are children of the shared `SceneComposition` stage, so
 * they are cropped, scaled and placed with the world art at every viewport, and
 * they sit above the Rig and below the frame-relative portrait.
 *
 * Purely decorative (`aria-hidden`), pointer-transparent, and painted with the
 * existing arcane tokens; the only motion is the cue player's own.
 */
export function SceneCueStageLayers({ state }: { state: SceneCueState }) {
  const { core, rift } = RESONANCE_RIG_CUE_ANCHORS;
  const gradientId = useId();
  const coreStyle: CSSProperties = {
    left: `${core.left}%`,
    top: `${core.top}%`,
    // The stage is 4:1, so a square in stage-width percent is 4x too tall in height
    // percent; an aspect-ratio box keeps the glow round at every crop.
    width: `${core.size}%`,
    aspectRatio: "1 / 1",
    transform: "translate(-50%, -50%)",
    ...sceneCueLayerStyle("core", state),
  };
  // The core's transform is the centring translate; only its opacity animates.
  const riftStyle: CSSProperties = {
    left: `${rift.left}%`,
    top: `${rift.top}%`,
    width: `${rift.width}%`,
    height: `${rift.height}%`,
    transformOrigin: "50% 50%",
    ...sceneCueLayerStyle("rift", state),
  };
  return (
    <>
      <span
        aria-hidden="true"
        className="rs-scene-cue-core pointer-events-none absolute rounded-full"
        data-scene-cue-target="core"
        style={coreStyle}
      />
      <span
        aria-hidden="true"
        className="rs-scene-cue-rift pointer-events-none absolute"
        data-scene-cue-target="rift"
        style={riftStyle}
      >
        <svg
          className="h-full w-full overflow-visible"
          preserveAspectRatio="none"
          viewBox="0 0 24 100"
        >
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="var(--rs-accent-arcane)" />
              <stop offset="0.5" stopColor="var(--rs-accent-primary)" />
              <stop offset="1" stopColor="var(--rs-accent-arcane)" />
            </linearGradient>
          </defs>
          <path
            d="M13 0 L8 14 L17 29 L6 46 L18 61 L9 78 L14 100"
            fill="none"
            filter="blur(2.2px)"
            opacity="0.7"
            stroke={`url(#${gradientId})`}
            strokeLinejoin="round"
            strokeWidth="5"
          />
          <path
            d="M13 0 L8 14 L17 29 L6 46 L18 61 L9 78 L14 100"
            fill="none"
            stroke={`url(#${gradientId})`}
            strokeLinejoin="round"
            strokeWidth="1.6"
          />
        </svg>
      </span>
    </>
  );
}
