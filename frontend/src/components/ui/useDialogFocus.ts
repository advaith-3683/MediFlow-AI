import { useEffect, useRef, type RefObject } from "react";

export function useDialogFocus(open: boolean, container: RefObject<HTMLElement | null>, onClose: () => void, busy = false, restoreFocus?: RefObject<HTMLElement | null>) {
  const latest = useRef({ onClose, busy });
  useEffect(() => { latest.current = { onClose, busy }; }, [onClose, busy]);
  useEffect(() => {
    if (!open) return;
    const previous = restoreFocus?.current ?? document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const controls = () => Array.from(container.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]') ?? []).filter(element => !element.hidden && element.getAttribute("aria-hidden") !== "true");
    (controls()[0] ?? container.current)?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!latest.current.busy) latest.current.onClose(); }
      if (event.key !== "Tab") return;
      const elements = controls(), first = elements[0], last = elements.at(-1);
      if (!first) { event.preventDefault(); container.current?.focus(); return; }
      if (!container.current?.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKey, true);
    return () => {
      document.removeEventListener("keydown", handleKey, true);
      document.body.style.overflow = overflow;
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [open, container, restoreFocus]);
}
