import type { LocalInferenceAdapterImpl } from "../../agent/inference/localInferenceAdapter";
import type { DocumentImportReviewDraft, SqliteExecutor } from "../../core/contracts/types";
import type { VoiceInputAdapter } from "../../core/hardware/voiceAdapter";
import type { OcrPort } from "../../core/ports/mediaPorts";
import { PricingCatalogPanel } from "./PricingCatalogPanel";

interface PricingCatalogViewProps {
  executor: SqliteExecutor;
  ocrPort: OcrPort;
  refreshTick: number;
  voiceAdapter?: VoiceInputAdapter;
  inferenceAdapter?: LocalInferenceAdapterImpl;
  registerBackHandler?: (priority: number, handler: () => boolean) => () => void;
  onOpenDocumentImport: (draft: DocumentImportReviewDraft, currentHourlyRateCents: number) => void;
  onDataChanged: () => Promise<void>;
}

export function PricingCatalogView(props: PricingCatalogViewProps) {
  return (
    <div data-testid="pricing-catalog-view" className="cotton-paper flex flex-1 flex-col overflow-y-auto no-scrollbar p-4 bg-[#F9F7F2] text-[#2C2621] font-sans">
      <PricingCatalogPanel {...props} />
    </div>
  );
}
