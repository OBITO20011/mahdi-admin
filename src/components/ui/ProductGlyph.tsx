import React from 'react';

const tones = ['bg-nw-info-bg text-nw-info', 'bg-nw-ok-bg text-nw-ok', 'bg-nw-warn-bg text-nw-warn', 'bg-nw-mute-bg text-nw-mute-fg'];
/** A product photo or its actual name initial. Colour is decoration, not stock status. */
export function ProductGlyph({ name, image, className = '' }: { name: string; image?: string; className?: string }) {
  const tone = [...name].reduce((sum, character) => sum + character.codePointAt(0)!, 0) % tones.length;
  return image ? <img src={image} alt="" className={`rounded-xl object-cover ${className}`} />
    : <span aria-hidden="true" className={`flex items-center justify-center rounded-xl text-3xl font-bold ${tones[tone]} ${className}`}>{name.trim().charAt(0)}</span>;
}
