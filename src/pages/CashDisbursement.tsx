import { DetectionConsole } from "@/features/detection/DetectionConsole";
import { CASH_CONFIG } from "@/data/typologies";

export default function CashDisbursement() {
  return <DetectionConsole config={CASH_CONFIG} />;
}
