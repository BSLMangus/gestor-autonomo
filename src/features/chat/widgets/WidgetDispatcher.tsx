import { useMemo } from "react";
import { ActiveWidgetEnvelopeSchema } from "../../../core/contracts/schemas";
import type { ActiveWidgetEnvelope } from "../../../core/contracts/types";
import { ClientProfileWidget } from "./ClientProfileWidget";
import { FiscalPiggyBankWidget } from "./FiscalPiggyBankWidget";
import { JobLifecycleActionWidget } from "./JobLifecycleActionWidget";
import { QuoteBuilderWidget } from "./QuoteBuilderWidget";
import { ScheduleWorkLogWidget } from "../../calendar/ScheduleWorkLogWidget";
import { SiteLogStampWidget } from "./SiteLogStampWidget";
import { TicketOcrValidatorWidget } from "./TicketOcrValidatorWidget";
import type { WidgetCommonProps } from "./widgetTypes";

function assertNeverWidget(x: never): never {
  throw new Error(`WIDGET_DISPATCH_ERROR: Tipo A2UI no soportado: ${JSON.stringify(x)}`);
}

export function WidgetDispatcher(props: WidgetCommonProps) {
  const widgetKey = useMemo(() => JSON.stringify(props.widget), [props.widget]);
  const validated = useMemo(
    () => ActiveWidgetEnvelopeSchema.safeParse(props.widget),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [widgetKey]
  );

  if (!validated.success) {
    return (
      <div
        role="alert"
        className="mt-2 rounded-xl border border-rose-300 bg-rose-50 p-3 text-xs text-rose-800"
      >
        Error de contrato A2UI (SCHEMA_VALIDATION_ERROR):{" "}
        {validated.error.issues.map((i) => i.message).join(" · ")}
      </div>
    );
  }

  const envelope: ActiveWidgetEnvelope = validated.data;
  const safeProps: WidgetCommonProps = { ...props, widget: envelope };

  switch (envelope.ui_widget_type) {
    case "QuoteBuilderWidget":
      return <QuoteBuilderWidget {...safeProps} />;
    case "TicketOcrValidatorWidget":
      return <TicketOcrValidatorWidget {...safeProps} />;
    case "FiscalPiggyBankWidget":
      return <FiscalPiggyBankWidget {...safeProps} />;
    case "JobLifecycleActionWidget":
      return <JobLifecycleActionWidget {...safeProps} />;
    case "SiteLogStampWidget":
      return <SiteLogStampWidget {...safeProps} />;
    case "ClientProfileWidget":
      return <ClientProfileWidget {...safeProps} />;
    case "ScheduleWorkLogWidget":
      return <ScheduleWorkLogWidget {...safeProps} />;
    default:
      return assertNeverWidget(envelope);
  }
}
