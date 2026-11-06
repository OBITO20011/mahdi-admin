// Loaded after a successful addition. No cart state, network, timers delaying
// persistence, image URLs, or dependencies belong to this decorative layer.
const flights = new Set<() => void>();
const bounces = new WeakMap<Element, Animation>();
const DURATION = 560;
const cartIcon = (target: Element) => target.querySelector('svg') ?? target;

function visible(element: Element) {
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0
    && rect.top < innerHeight && rect.left < innerWidth
    && style.visibility !== 'hidden' && style.display !== 'none';
}

function cartTarget() {
  // Prefer the header. The mobile navigation is the visible fallback when
  // the header has scrolled out of view; never fly to an off-screen target.
  const targets = [...document.querySelectorAll<HTMLElement>('[data-cart-target]')];
  return targets.find(target => visible(cartIcon(target))) ?? targets[0];
}

function bounce(target: HTMLElement) {
  const icon = cartIcon(target);
  if (typeof icon.animate !== 'function') return;
  bounces.get(icon)?.cancel();
  const animation = icon.animate([
    {transform: 'translateY(0)'}, {transform: 'translateY(-5px)', offset: .45},
    {transform: 'translateY(0)'},
  ], {duration: 240, easing: 'ease-out'});
  bounces.set(icon, animation);
  void animation.finished.catch(() => {}).finally(() => {
    if (bounces.get(icon) === animation) bounces.delete(icon);
  });
}

export function cancelCartFlights() {
  for (const finish of [...flights]) finish();
}

window.addEventListener('pagehide', cancelCartFlights);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) cancelCartFlights();
});

export function animateCartAddition(source?: HTMLElement) {
  // A missing/unsupported animation API is a harmless no-op. Reduced motion
  // also skips the bounce. Callers already committed the addition and toast.
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const target = cartTarget();
  if (!target) return;
  if (!visible(cartIcon(target)) || !source?.isConnected || source.closest('[role="dialog"], [aria-modal="true"]')
      || [...document.querySelectorAll('[aria-modal="true"]')].some(dialog =>
        !dialog.closest('[inert], [aria-hidden="true"]') && visible(dialog)) || flights.size >= 3
      || typeof Element.prototype.animate !== 'function') {
    bounce(target);
    return;
  }

  const image = source.querySelector('img');
  const origin = image && visible(image) ? image : source;
  if (!visible(origin)) { bounce(target); return; }
  const from = origin.getBoundingClientRect(), to = cartIcon(target).getBoundingClientRect();
  const overlay = document.createElement('canvas');
  overlay.width = overlay.height = 144;
  overlay.dataset.cartFlight = '';
  overlay.setAttribute('aria-hidden', 'true');
  const size = 64;
  const x = Math.max(0, Math.min(innerWidth - size, from.left + (from.width - size) / 2));
  const y = Math.max(0, Math.min(innerHeight - size, from.top + (from.height - size) / 2));
  Object.assign(overlay.style, {
    position: 'fixed', left: `${x}px`, top: `${y}px`, width: `${size}px`, height: `${size}px`,
    pointerEvents: 'none', borderRadius: '50%', background: '#e6d5b8',
    boxShadow: '0 5px 16px #49362533', zIndex: '80',
  });
  // Draw the already decoded displayed thumbnail directly. A cross-origin
  // image may taint this canvas; it is never read/exported, so no CORS fetch
  // or new image request is needed. Missing images remain a brand-colour disc.
  const context = overlay.getContext('2d');
  if (context && image?.complete && image.naturalWidth > 0) {
    const ratio = Math.min(144 / image.naturalWidth, 144 / image.naturalHeight);
    const width = image.naturalWidth * ratio, height = image.naturalHeight * ratio;
    context.drawImage(image, (144 - width) / 2, (144 - height) / 2, width, height);
    overlay.dataset.cartFlightImage = 'displayed';
  }

  let animation: Animation | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    flights.delete(finish);
    animation?.cancel();
    overlay.remove();
  };
  flights.add(finish);
  try {
    document.body.append(overlay);
    const dx = to.left + to.width / 2 - x - size / 2;
    const dy = to.top + to.height / 2 - y - size / 2;
    const controlY = Math.min(0, dy) - Math.max(90, Math.abs(dx) * .3);
    const frames = Array.from({length: 21}, (_, index) => {
      const t = index / 20;
      const bx = dx * t; // quadratic Bezier controlX=dx/2
      const by = 2 * (1 - t) * t * controlY + t * t * dy;
      return {transform: `translate(${bx}px, ${by}px) scale(${1 - .65 * t})`,
        opacity: t < .85 ? 1 : (1 - t) / .15, offset: t};
    });
    animation = overlay.animate(frames, {duration: DURATION, easing: 'linear'});
    void animation.finished.then(() => { if (!done && target.isConnected) bounce(target); })
      .catch(() => {}).finally(finish);
    // Cleanup still holds if a browser stops resolving WAAPI promises.
    timer = setTimeout(finish, DURATION + 150);
  } catch { finish(); }
}
