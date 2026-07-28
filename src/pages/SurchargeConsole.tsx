import { DetectionConsole } from "@/features/detection/DetectionConsole";
import { SURCHARGE_CONFIG } from "@/data/typologies";

export default function SurchargeConsole() {
  return <DetectionConsole config={SURCHARGE_CONFIG} />;
}
