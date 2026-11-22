import type { DocumentImportReviewDraft, SqliteExecutor } from "../../core/contracts/types";
import type { OcrPort } from "../../core/ports/mediaPorts";
import { PricingCatalogPanel } from "./PricingCatalogPanel";

interface PricingCatalogViewProps {
  executor: SqliteExecutor;
  ocrPort: OcrPort;
  refreshTick: number;
  onOpenDocumentImport: (draft: DocumentImportReviewDraft, currentHourlyRateCents: number) => void;
  onDataChanged: () => Promise<void>;
}

export function PricingCatalogView(props: PricingCatalogViewProps) {
  return (
    <div data-testid="pricing-catalog-view" className="flex flex-1 flex-col overflow-y-auto no-scrollbar p-4 bg-surface">
      <PricingCatalogPanel {...props} />
    </div>
  );
}
