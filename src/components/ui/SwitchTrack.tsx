import React from 'react';

/** Pure visual track. The owning switch retains its role, state and handler. */
export function SwitchTrack({enabled}: {enabled: boolean}) {
  return <span aria-hidden="true" data-ui="switch-track" className={`relative inline-block h-6 w-11 shrink-0 rounded-full ${enabled ? 'bg-nw-ok' : 'bg-nw-muted'}`}>
    <span className={`absolute top-1 h-4 w-4 rounded-full bg-nw-surface transition-transform ${enabled ? 'right-1' : 'left-1'}`} />
  </span>;
}
