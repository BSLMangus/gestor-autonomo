import React from 'react';
import { AppStoreProvider, useAppStore } from './services/mockStore';
import { MobileShell } from './components/shell/MobileShell';
import { HomeHubView } from './features/home/HomeHubView';
import { ChatTimelineView } from './features/chat/ChatTimelineView';
import { CalendarScheduleView } from './features/calendar/CalendarScheduleView';
import { JobsView } from './features/jobs/JobsView';
import { QuotesView } from './features/quotes/QuotesView';
import { ClientsView } from './features/clients/ClientsView';
import { ClientProfileView } from './features/clients/ClientProfileView';
import { FiscalDashboardView } from './features/fiscal/FiscalDashboardView';
import { InspectorView } from './features/activity/InspectorView';
import { PricingCatalogView } from './features/pricing/PricingCatalogView';
import { SettingsSheet } from './features/settings/SettingsSheet';

function RouteContent() {
  const { route } = useAppStore();

  if (route.startsWith('#/clientes/')) {
    const clientId = route.replace('#/clientes/', '');
    return (
      <MobileShell title="Ficha de Cliente">
        <ClientProfileView clientId={clientId} />
      </MobileShell>
    );
  }

  switch (route) {
    case '#/asistente':
      return (
        <MobileShell title="Asistente de Obra" subtitle="100% Local · Sin nube">
          <ChatTimelineView />
        </MobileShell>
      );
    case '#/calendario':
      return (
        <MobileShell title="Agenda y Calendario">
          <CalendarScheduleView />
        </MobileShell>
      );
    case '#/obras':
      return (
        <MobileShell title="Obras">
          <JobsView />
        </MobileShell>
      );
    case '#/presupuestos':
      return (
        <MobileShell title="Presupuestos y Facturas">
          <QuotesView />
        </MobileShell>
      );
    case '#/clientes':
      return (
        <MobileShell title="Clientes">
          <ClientsView />
        </MobileShell>
      );
    case '#/hucha':
      return (
        <MobileShell title="Hucha Fiscal">
          <FiscalDashboardView />
        </MobileShell>
      );
    case '#/actividad':
      return (
        <MobileShell title="Actividad">
          <InspectorView />
        </MobileShell>
      );
    case '#/tarifario':
      return (
        <MobileShell title="Tarifario y Precios">
          <PricingCatalogView />
        </MobileShell>
      );
    case '#/ajustes':
      return (
        <MobileShell title="Ajustes y Horario">
          <SettingsSheet />
        </MobileShell>
      );
    case '#/':
    default:
      return (
        <MobileShell title="ObraLocal AI">
          <HomeHubView />
        </MobileShell>
      );
  }
}

export default function App() {
  return (
    <AppStoreProvider>
      <RouteContent />
    </AppStoreProvider>
  );
}
