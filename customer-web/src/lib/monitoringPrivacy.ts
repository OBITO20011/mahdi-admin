import type {Breadcrumb, ErrorEvent} from '@sentry/react';
// Allowlisted diagnostics only. Never forward raw messages, scope, input, URLs or values.
const codes=['FRONTEND_ERROR','REACT_RENDER_ERROR','CHUNK_LOAD_ERROR','PWA_UPDATE_ERROR'] as const;
export function sanitizeEvent(event: ErrorEvent): ErrorEvent {
 const component=['AppErrorBoundary','StoreErrorBoundary'].find(c=>event.tags?.component===c);
 const screen=['/','/orders','/products','/cart','/checkout'].find(p=>event.tags?.screen===p)??'/';
 const code=codes.find(c=>event.tags?.error_code===c)??'FRONTEND_ERROR';
 return {type:undefined,event_id:/^[a-f0-9]{32}$/iu.test(event.event_id??'')?event.event_id:undefined,timestamp:typeof event.timestamp==='number'&&Number.isFinite(event.timestamp)?event.timestamp:undefined,platform:'javascript',level:'error',
  release:/^[a-f0-9]{40}$/iu.test(event.release??'')?event.release:undefined,environment:['production','staging','prelaunch-trial'].includes(event.environment??'')?event.environment:undefined,message:code,
  exception:{values:[{type:'Error',value:code}]},
  tags:{error_code:code,screen,...(component?{component}:{})}};
}
export function sanitizeBreadcrumb(_breadcrumb: Breadcrumb): Breadcrumb|null {return null;}
