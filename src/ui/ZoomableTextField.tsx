import { useEffect, useId, useRef } from "react";
import { useZoomTextEditor } from "./zoomTextEditorContext";

export interface ZoomableTextFieldProps {
  as?: "textarea" | "input";
  zoomLabel: string;
  multiline?: boolean;
  value: string;
  onValueChange: (nextValue: string) => void;
  id?: string;
  "data-testid"?: string;
  "aria-label"?: string;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  disabled?: boolean;
  className?: string;
}

/**
 * Campo reutilizable que conserva la apariencia e interacción inline normal y, cuando
 * la preferencia está activa, al tocarlo se amplía en una tarjeta flotante editable.
 */
export function ZoomableTextField({
  as = "textarea",
  zoomLabel,
  multiline,
  value,
  onValueChange,
  id,
  "data-testid": dataTestId,
  "aria-label": ariaLabel,
  placeholder,
  rows,
  maxLength,
  disabled = false,
  className = "",
}: ZoomableTextFieldProps) {
  const fieldId = useId();
  const { enabled, openEditor, abortField } = useZoomTextEditor();
  const latestOnChangeRef = useRef(onValueChange);
  latestOnChangeRef.current = onValueChange;

  const isMultiline = multiline ?? as !== "input";

  useEffect(() => {
    if (disabled) {
      abortField(fieldId);
    }
  }, [disabled, fieldId, abortField]);

  useEffect(() => {
    return () => {
      abortField(fieldId);
    };
  }, [fieldId, abortField]);

  const handleTriggerClick = (
    e: React.MouseEvent<HTMLTextAreaElement | HTMLInputElement>
  ) => {
    if (!enabled || disabled) return;
    const rect = e.currentTarget.getBoundingClientRect();
    openEditor({
      fieldId,
      label: zoomLabel,
      initialValue: value,
      placeholder,
      multiline: isMultiline,
      maxLength,
      sourceRect: rect,
      onCommit: (next) => latestOnChangeRef.current(next),
    });
  };

  const mergedClassName = enabled && !disabled ? `${className} cursor-text` : className;

  if (as === "input") {
    return (
      <input
        id={id}
        type="text"
        data-testid={dataTestId}
        aria-label={ariaLabel}
        placeholder={placeholder}
        maxLength={maxLength}
        disabled={disabled}
        value={value}
        onClick={handleTriggerClick}
        onChange={(e) => latestOnChangeRef.current(e.target.value)}
        className={mergedClassName}
      />
    );
  }

  return (
    <textarea
      id={id}
      rows={rows ?? 2}
      data-testid={dataTestId}
      aria-label={ariaLabel}
      placeholder={placeholder}
      maxLength={maxLength}
      disabled={disabled}
      value={value}
      onClick={handleTriggerClick}
      onChange={(e) => latestOnChangeRef.current(e.target.value)}
      className={mergedClassName}
    />
  );
}
