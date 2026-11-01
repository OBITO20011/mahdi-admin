/** Keep native smooth scrolling; small fallback for browsers without CSSOM scrollTo. */
export function scrollElementTo(element: HTMLElement | null, options: ScrollToOptions): void {
  if (!element) return;
  if (typeof element.scrollTo === 'function') {element.scrollTo(options); return;}
  if (typeof options.left === 'number') element.scrollLeft = options.left;
  if (typeof options.top === 'number') element.scrollTop = options.top;
}

export function scrollWindowTo(options: ScrollToOptions, view: Pick<Window, 'scrollTo' | 'document'> = window): void {
  if (typeof view.scrollTo === 'function') {view.scrollTo(options); return;}
  const root = view.document.scrollingElement ?? view.document.documentElement;
  if (!root) return;
  if (typeof options.left === 'number') root.scrollLeft = options.left;
  if (typeof options.top === 'number') root.scrollTop = options.top;
}
