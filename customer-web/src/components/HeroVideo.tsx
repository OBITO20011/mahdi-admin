import {useEffect, useRef, useState} from 'react';
import {allowsHeroVideo} from '../utils/heroMedia';
import type {HeroConnection} from '../utils/heroMedia';

const desktopQuery = '(min-width: 768px)';
const motionQuery = '(prefers-reduced-motion: reduce)';
const preferences = () => ({
  desktop: matchMedia(desktopQuery).matches,
  allowed: allowsHeroVideo(matchMedia(motionQuery).matches,
    (navigator as Navigator & {connection?: HeroConnection}).connection),
});

export default function HeroVideo({desktop}: {desktop: boolean}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const [policy, setPolicy] = useState(preferences);
  const eligible = policy.allowed && policy.desktop === desktop;
  useEffect(() => {
    const update = () => setPolicy(preferences());
    const connection = (navigator as Navigator & {connection?: HeroConnection & EventTarget}).connection;
    const signals = [matchMedia(desktopQuery), matchMedia(motionQuery), connection];
    for (const signal of signals) signal?.addEventListener?.('change', update);
    return () => { for (const signal of signals) signal?.removeEventListener?.('change', update); };
  }, []);
  useEffect(() => {
    const video = ref.current;
    if (!video || !eligible || failed) return;
    let active = true;
    const fail = () => { if (active) { video.pause(); setFailed(true); } };
    video.muted = true;
    try {
      void video.play()?.catch(fail);
    } catch { fail(); }
    return () => { active = false; video.pause(); };
  }, [eligible, failed]);
  if (!eligible || failed) return null;
  return <video ref={ref} data-testid={desktop ? 'desktop-hero-video' : undefined}
    aria-hidden="true" autoPlay muted loop playsInline preload="metadata"
    disablePictureInPicture poster="/nawasrah-hero-poster.webp"
    onPlaying={() => setPlaying(true)} onError={() => { ref.current?.pause(); setFailed(true); }}
    style={{opacity: playing ? 1 : 0}}
    className={desktop ? 'absolute inset-0 -z-20 h-full w-full bg-[#07152f] object-contain object-center'
      : 'absolute inset-0 h-full w-full bg-[#07152f] object-contain'}>
    <source src={desktop ? '/nawasrah-hero-desktop-1080p.mp4' : '/nawasrah-hero-mobile.mp4'} type="video/mp4" />
  </video>;
}

