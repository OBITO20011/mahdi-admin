/** DOM-only modal presentation. No navigation, close policy or application state. */
const inerted = new Map<HTMLElement, boolean>();
let releasePage: (() => void) | undefined;
let releaseLayer: (() => void) | undefined;
let currentLayer: HTMLElement | undefined;
let observer: MutationObserver | undefined;
let allowed: HTMLElement | undefined;

function rememberExternalInert(records: MutationRecord[]) {
  for (const record of records) {
    if (record.type === 'attributes' && record.target instanceof HTMLElement && inerted.has(record.target)) {
      inerted.set(record.target, record.target.inert);
    }
  }
}
function restoreInert() {
  rememberExternalInert(observer?.takeRecords() ?? []);
  inerted.forEach((value, element) => { element.inert = value; });
  inerted.clear();
  // Do not mistake our own restoration for a caller's independent inert lock.
  observer?.takeRecords();
}
function isolate() {
  restoreInert();
  for (let child = allowed; child?.parentElement; child = child.parentElement) {
    for (const sibling of child.parentElement.children) {
      if (sibling !== child && sibling instanceof HTMLElement) {
        inerted.set(sibling, sibling.inert); sibling.inert = true;
      }
    }
    if (child.parentElement === document.body) break;
  }
  observer?.takeRecords();
}
/** Release only locks owned by this stack before testing a newly mounted layer.
 * A sibling dialog may have committed under an ancestor we made inert. Callers'
 * independent locks are retained, and isolation is re-established synchronously.
 */
export function prepareDialogActivation() { restoreInert(); }
function lockPage() {
  const x = window.scrollX, y = window.scrollY, body = document.body, html = document.documentElement;
  const before = new Map(['position','top','left','width','overflow'].map(key => [key, body.style.getPropertyValue(key)]));
  const overflow = html.style.overflow;
  Object.assign(body.style, {position:'fixed', top:`-${y}px`, left:`-${x}px`, width:'100%', overflow:'hidden'});
  html.style.overflow = 'hidden';
  // Capture stops scroll chaining/rubber-banding on iOS, but preserves pinch zoom.
  const preventOutside = (event: Event) => {
    if (allowed && !event.composedPath().includes(allowed)) { event.preventDefault(); event.stopImmediatePropagation(); }
  };
  document.addEventListener('pointerdown', preventOutside, true);
  document.addEventListener('click', preventOutside, true);
  const touch = (event: TouchEvent) => { if (event.touches.length === 1) preventOutside(event); };
  document.addEventListener('touchmove', touch, {capture:true, passive:false});
  const viewport = () => {
    const v = window.visualViewport;
    html.style.setProperty('--nw-dialog-height', `${v?.height ?? window.innerHeight}px`);
    html.style.setProperty('--nw-dialog-top', `${v?.offsetTop ?? 0}px`);
  };
  const height = html.style.getPropertyValue('--nw-dialog-height'), top = html.style.getPropertyValue('--nw-dialog-top');
  viewport(); window.addEventListener('resize', viewport);
  window.visualViewport?.addEventListener('resize', viewport); window.visualViewport?.addEventListener('scroll', viewport);
  observer = new MutationObserver(records => { rememberExternalInert(records); isolate(); });
  observer.observe(body, {childList:true, subtree:true, attributes:true, attributeFilter:['inert']});
  return () => {
    observer?.disconnect(); observer = undefined;
    document.removeEventListener('pointerdown', preventOutside, true); document.removeEventListener('click', preventOutside, true);
    document.removeEventListener('touchmove', touch, true);
    window.removeEventListener('resize', viewport);
    window.visualViewport?.removeEventListener('resize', viewport); window.visualViewport?.removeEventListener('scroll', viewport);
    before.forEach((value, key) => body.style.setProperty(key, value)); html.style.overflow = overflow;
    html.style.setProperty('--nw-dialog-height', height); html.style.setProperty('--nw-dialog-top', top);
    const behavior = html.style.scrollBehavior; html.style.scrollBehavior = 'auto';
    window.scrollTo(x, y); html.style.scrollBehavior = behavior;
  };
}
function layerFor(panel: HTMLElement) {
  for (let element: HTMLElement | null = panel; element && element !== document.body; element = element.parentElement) {
    if (getComputedStyle(element).position === 'fixed') return element;
    if (element !== panel && element.getAttribute('role') === 'dialog') break;
  }
  return panel;
}
function elevate(layer: HTMLElement) {
  layer.setAttribute('data-nw-dialog-layer', '');
  // A manual popover uses the browser's top layer without reparenting React DOM,
  // changing Escape/Back behavior or suffering transformed/overflow ancestors.
  // It is not light-dismissed; the existing modal handlers remain authoritative.
  const popover = layer.getAttribute('popover');
  if (typeof layer.showPopover === 'function') {
    layer.setAttribute('popover', 'manual'); layer.showPopover();
    return () => {
      if (layer.matches(':popover-open')) layer.hidePopover();
      if (popover === null) layer.removeAttribute('popover'); else layer.setAttribute('popover', popover);
      layer.removeAttribute('data-nw-dialog-layer');
    };
  }
  // Older engines: temporarily remove ancestor clipping/stacking contexts only.
  const saved: Array<() => void> = [];
  for (let element: HTMLElement | null = layer; element && element !== document.body; element = element.parentElement) {
    const target = element;
    const before = target.getAttribute('style');
    Object.assign(target.style, {zIndex:'2147483000', overflow:'visible', transform:'none', filter:'none', contain:'none'});
    if (getComputedStyle(target).position === 'static') target.style.position = 'relative';
    saved.push(() => {if (before === null) target.removeAttribute('style'); else target.setAttribute('style', before);});
  }
  return () => {saved.reverse().forEach(restore => restore()); layer.removeAttribute('data-nw-dialog-layer');};
}
export function syncDialogIsolation(panels: readonly HTMLElement[]) {
  const panel = [...panels].reverse().find(element => element.isConnected);
  const layer = panel ? layerFor(panel) : undefined;
  restoreInert();
  if (layer !== currentLayer) { releaseLayer?.(); releaseLayer = undefined; currentLayer = layer; }
  allowed = layer;
  if (layer) {
    releasePage ??= lockPage();
    releaseLayer ??= elevate(layer);
    isolate();
  } else { releasePage?.(); releasePage = undefined; }
}
