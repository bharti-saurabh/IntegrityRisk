import { DetectionConsole } from "@/features/detection/DetectionConsole";
import { FACTORING_CONFIG } from "@/data/typologies";

export default function FactoringExplorer() {
  return <DetectionConsole config={FACTORING_CONFIG} />;
}
