/** Active dialogs share a stack: only the top dialog handles keyboard/focus. */
const dialogs: HTMLElement[] = [];
let handoverTarget: HTMLElement | null = null;
const selector = 'button, a[href], input, select, textarea, summary, [tabindex]';
let lastPointer: {element: HTMLElement; at: number} | null = null;
if (typeof document !== 'undefined') document.addEventListener('pointerdown', event => {
  const element = event.target instanceof Element ? event.target.closest<HTMLElement>(selector) : null;
  lastPointer = element ? {element, at: performance.now()} : null;
}, true);
function focusable(panel: HTMLElement): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>(selector)].filter(element =>
    element.tabIndex >= 0 && !element.matches(':disabled')
    && !element.closest('[inert], [aria-hidden="true"]') && element.getClientRects().length > 0);
}
function available(element: HTMLElement | null): element is HTMLElement {
  return Boolean(element?.isConnected && element !== document.body
    && !element.matches(':disabled') && !element.closest('[inert], [aria-hidden="true"]')
    && element.getClientRects().length);
}
function activeDialog(): HTMLElement | undefined {
  return [...dialogs].reverse().find(dialog => available(dialog));
}
function restoreAfterCommit(opener: HTMLElement, closedPanel: HTMLElement) {
  requestAnimationFrame(() => {
    const current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!activeDialog() && available(opener)
      && !(available(current) && !closedPanel.contains(current))) opener.focus({preventScroll: true});
  });
}
export function activateDialog(panel: HTMLElement, onEscape: () => void): () => void {
  if (!available(panel)) return () => undefined;
  const pointer = lastPointer && performance.now() - lastPointer.at < 1000
    && !panel.contains(lastPointer.element) ? lastPointer.element : null;
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  // During dialog handover the old button may be inert. Carry the real opener,
  // not an input already focused in the new dialog, across that handover.
  // An opener can be hidden by the same commit that displays a full-screen
  // dialog (the POS sticky bar). Retain its identity now; require availability
  // at restoration time, never focus a hidden/disabled/inert element.
  const previous = pointer?.isConnected ? pointer
    : available(active) && !panel.contains(active) ? active
    : available(handoverTarget) ? handoverTarget : null;
  handoverTarget = null;
  const descendant = dialogs.findIndex(dialog => panel.contains(dialog));
  if (descendant < 0) dialogs.push(panel);
  else dialogs.splice(descendant, 0, panel);
  const top = () => activeDialog() === panel;
  const focusFirst = () => (focusable(panel)[0] || panel).focus({preventScroll: true});
  // Animation does not have to finish before keyboard access becomes safe.
  // Do not steal an already valid interaction; neutral initial focus also
  // prevents immediate Enter from activating the first (close) button.
  if (top() && !(available(active) && panel.contains(active))) panel.focus({preventScroll: true});
  const keydown = (event: KeyboardEvent) => {
    if (!top() || event.defaultPrevented) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); onEscape();
    } else if (event.key === 'Tab' && !event.altKey && !event.ctrlKey && !event.metaKey) {
      const items = focusable(panel);
      const index = items.indexOf(document.activeElement as HTMLElement);
      if (index < 0 && panel.contains(document.activeElement) && document.activeElement !== panel) return;
      if (!items.length || index < 0 || (!event.shiftKey && index === items.length - 1)
        || (event.shiftKey && index === 0)) {
        event.preventDefault();
        (event.shiftKey ? items.at(-1) || panel : items[0] || panel).focus();
      }
    }
  };
  const focusin = (event: FocusEvent) => {
    if (top() && !panel.contains(event.target as Node)) focusFirst();
  };
  document.addEventListener('keydown', keydown, true);
  document.addEventListener('focusin', focusin);
  return () => {
    const wasTop = dialogs.at(-1) === panel;
    const index = dialogs.indexOf(panel);
    if (index >= 0) dialogs.splice(index, 1);
    document.removeEventListener('keydown', keydown, true);
    document.removeEventListener('focusin', focusin);
    const remaining = activeDialog();
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // A newly displayed dialog may have committed before its layout effect.
    // Its valid active element wins over restoration from the closed dialog.
    if (wasTop && available(focused) && !panel.contains(focused)
      && focused.closest('[role="dialog"]')) {
      if (available(previous)) handoverTarget = previous;
      return;
    }
    if (wasTop && available(previous)
      && (!remaining || remaining.contains(previous))) previous.focus({preventScroll: true});
    else if (wasTop && remaining && !(available(focused) && remaining.contains(focused))) {
      remaining.focus({preventScroll: true});
    }
    else if (wasTop && previous?.isConnected && !remaining && !available(previous)) {
      // React layout cleanup can precede the sibling commit that reveals the
      // opener. Check once after that commit, without stealing a new interaction
      // or overriding a newly opened dialog. No retries or arbitrary delay.
      restoreAfterCommit(previous, panel);
    }
  };
}
