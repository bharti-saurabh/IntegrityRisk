import { DetectionConsole } from "@/features/detection/DetectionConsole";
import { SPLIT_CONFIG } from "@/data/typologies";

export default function SplitTicketingLab() {
  return <DetectionConsole config={SPLIT_CONFIG} />;
}
