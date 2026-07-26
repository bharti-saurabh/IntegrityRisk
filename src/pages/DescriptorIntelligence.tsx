import { DetectionConsole } from "@/features/detection/DetectionConsole";
import { DESCRIPTOR_CONFIG } from "@/data/typologies";

export default function DescriptorIntelligence() {
  return <DetectionConsole config={DESCRIPTOR_CONFIG} />;
}
