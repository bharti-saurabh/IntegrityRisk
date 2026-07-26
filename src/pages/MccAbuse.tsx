import { DetectionConsole } from "@/features/detection/DetectionConsole";
import { MCC_ABUSE_CONFIG } from "@/data/typologies";

export default function MccAbuse() {
  return <DetectionConsole config={MCC_ABUSE_CONFIG} />;
}
