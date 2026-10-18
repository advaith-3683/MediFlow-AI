import { useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CircleHelp } from "lucide-react";
import { useDialogFocus } from "./useDialogFocus";

export default function ConfirmDialog({ open, title, children, confirmLabel = "Confirm", danger = false, busy = false, onCancel, onConfirm }: { open: boolean; title: string; children: ReactNode; confirmLabel?: string; danger?: boolean; busy?: boolean; onCancel: () => void; onConfirm: () => void }) {
  const panel = useRef<HTMLElement>(null);
  const titleId = useId(), descriptionId = useId();
  useDialogFocus(open, panel, onCancel, busy);
  if (!open) return null;
  const Icon = danger ? AlertTriangle : CircleHelp;
  return createPortal(<div className="mf-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) onCancel(); }}><section ref={panel} tabIndex={-1} role="alertdialog" aria-modal="true" aria-busy={busy} aria-labelledby={titleId} aria-describedby={descriptionId} className="mf-dialog"><span className={`mf-dialog-icon ${danger ? "text-red-700 bg-red-50" : "text-brand-700 bg-brand-50"}`}><Icon size={23} aria-hidden="true"/></span><h2 id={titleId} className="mt-5 text-xl font-semibold tracking-tight">{title}</h2><div id={descriptionId} className="mt-3 text-sm leading-6 text-slate-600">{children}</div><div className="mt-7 flex flex-wrap justify-end gap-3"><button type="button" disabled={busy} onClick={onCancel} className="mf-button mf-button-secondary">Cancel</button><button type="button" disabled={busy} onClick={onConfirm} className={`mf-button ${danger ? "mf-button-danger" : "mf-button-primary"}`}>{busy ? "Working…" : confirmLabel}</button></div></section></div>, document.body);
}
