import { createContext, useContext } from "react";

export interface ZoomEditorOpenRequest {
  fieldId: string;
  label: string;
  initialValue: string;
  placeholder?: string;
  multiline: boolean;
  maxLength?: number;
  sourceRect: DOMRect;
  onCommit: (nextValue: string) => void;
}

export interface ZoomTextEditorContextValue {
  enabled: boolean;
  setEnabled: (next: boolean) => Promise<void>;
  openEditor: (req: ZoomEditorOpenRequest) => void;
  abortField: (fieldId: string) => void;
}

const NOOP_CONTEXT: ZoomTextEditorContextValue = {
  enabled: false,
  setEnabled: async () => {},
  openEditor: () => {},
  abortField: () => {},
};

export const ZoomTextEditorContext = createContext<ZoomTextEditorContextValue>(NOOP_CONTEXT);

export function useZoomTextEditor(): ZoomTextEditorContextValue {
  return useContext(ZoomTextEditorContext);
}
