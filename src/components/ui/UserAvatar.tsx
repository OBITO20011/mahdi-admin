import React from 'react';

/** No remote default image: missing photos use the user's initial locally. */
export const UserAvatar: React.FC<{ name: string; src?: string; className?: string }> = ({ name, src, className = '' }) => (
  src?.trim()
    ? <img src={src} alt={name} className={`shrink-0 rounded-xl object-cover ${className}`} />
    : <span role="img" aria-label={name || 'المستخدم'} className={`flex shrink-0 items-center justify-center rounded-xl bg-nw-accent font-bold text-nw-on-accent ${className}`}>
      {name.trim().charAt(0) || 'م'}
    </span>
);
