export interface HeroConnection {
  saveData?: boolean;
  effectiveType?: string;
}

export function allowsHeroVideo(reducedMotion: boolean, connection?: HeroConnection) {
  return !reducedMotion && !connection?.saveData
    && !['slow-2g', '2g', '3g'].includes(connection?.effectiveType ?? '');
}

// Never compete with the document's initial load, and never require a gesture.
export function requestHeroVideoAfterLoad(request: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => { timer = setTimeout(request, 1000); };
  if (document.readyState === 'complete') schedule();
  else window.addEventListener('load', schedule, {once: true});
  return () => {
    window.removeEventListener('load', schedule);
    clearTimeout(timer);
  };
}
