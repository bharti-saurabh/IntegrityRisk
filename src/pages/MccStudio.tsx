import { DetectionConsole } from "@/features/detection/DetectionConsole";
import { MISCODING_CONFIG } from "@/data/typologies";

export default function MccStudio() {
  return <DetectionConsole config={MISCODING_CONFIG} />;
}
