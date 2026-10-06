/** Active dialogs share a stack: only the top dialog handles keyboard/focus. */
const dialogs: HTMLElement[] = [];
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
export function activateDialog(panel: HTMLElement, onEscape: () => void): () => void {
  const pointer = lastPointer && performance.now() - lastPointer.at < 1000
    && !panel.contains(lastPointer.element) ? lastPointer.element : null;
  const previous = pointer || (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const descendant = dialogs.findIndex(dialog => panel.contains(dialog));
  if (descendant < 0) dialogs.push(panel);
  else dialogs.splice(descendant, 0, panel);
  const top = () => dialogs.at(-1) === panel;
  const focusFirst = () => (focusable(panel)[0] || panel).focus({preventScroll: true});
  // Animation does not have to finish before keyboard access becomes safe.
  if (top()) focusFirst();
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
    const wasTop = top();
    dialogs.splice(dialogs.indexOf(panel), 1);
    document.removeEventListener('keydown', keydown, true);
    document.removeEventListener('focusin', focusin);
    const remaining = dialogs.at(-1);
    if (wasTop && previous?.isConnected && !previous.closest('[inert]')
      && (!remaining || remaining.contains(previous))) previous.focus({preventScroll: true});
    else if (wasTop && remaining) (focusable(remaining)[0] || remaining).focus();
  };
}
