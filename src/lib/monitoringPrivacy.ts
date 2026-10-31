import type {Breadcrumb, ErrorEvent, StackFrame} from '@sentry/react';
// Fresh allowlisted diagnostics: no raw messages, scope, input or arbitrary URLs.
const codes=['FRONTEND_ERROR','REACT_RENDER_ERROR','CHUNK_LOAD_ERROR','PWA_UPDATE_ERROR'] as const;
const errorTypes=['Error','TypeError','RangeError','ReferenceError','SyntaxError','URIError','EvalError','AggregateError','ChunkLoadError'] as const;
const screens=['home','orders','sales_history','products','accounts','more','dashboard','pos','inventory','expenses','shifts','reports','users','purchases','assistant','go_live','cheques','warehouses'] as const;
export function monitoringScreen(value: unknown): string {
 return screens.find(s=>s===value)??'unknown';
}
interface DiagnosticLocation {screen?: unknown; origin?: string}
function safeFrames(event: ErrorEvent, origin: string): StackFrame[] {
 let ownOrigin: string;
 try {ownOrigin=new URL(origin).origin;} catch {return [];}
 return (event.exception?.values?.at(-1)?.stacktrace?.frames??[]).slice(-50).flatMap(frame=>{
  if(typeof frame.filename!=='string')return [];
  let url: URL;
  try {url=new URL(frame.filename,ownOrigin);}catch{return [];}
  // Only executable bundle/source paths. Business-route segments are never sent.
  if(url.origin!==ownOrigin||url.username||url.password||!/^\/(?:assets\/)?[A-Za-z0-9_.-]{1,160}\.(?:js|mjs|tsx?)$/u.test(url.pathname))return [];
  const safe: StackFrame={filename:ownOrigin+url.pathname};
  if(typeof frame.function==='string'&&frame.function.length<=100&&/^(?:[A-Za-z_$][A-Za-z0-9_$]*\.)*[A-Za-z_$][A-Za-z0-9_$]*$/u.test(frame.function)&&!/(?:\d{7}|token|password|secret|session|cart)/iu.test(frame.function))safe.function=frame.function;
  if(Number.isSafeInteger(frame.lineno)&&frame.lineno!>0&&frame.lineno!<=10_000_000)safe.lineno=frame.lineno;
  if(Number.isSafeInteger(frame.colno)&&frame.colno!>=0&&frame.colno!<=10_000_000)safe.colno=frame.colno;
  if(typeof frame.in_app==='boolean')safe.in_app=frame.in_app;
  return [safe];
 });
}
export function sanitizeEvent(event: ErrorEvent, location: DiagnosticLocation = {}): ErrorEvent {
 const component=['AppErrorBoundary','StoreErrorBoundary'].find(c=>event.tags?.component===c);
 const screen=monitoringScreen(location.screen??event.tags?.screen);
 const code=codes.find(c=>event.tags?.error_code===c)??'FRONTEND_ERROR';
 const type=errorTypes.find(t=>event.exception?.values?.at(-1)?.type===t)??'Error';
 const origin=location.origin??(typeof window==='undefined'?'':window.location.origin);
 const frames=safeFrames(event,origin);
 return {type:undefined,event_id:/^[a-f0-9]{32}$/iu.test(event.event_id??'')?event.event_id:undefined,timestamp:typeof event.timestamp==='number'&&Number.isFinite(event.timestamp)?event.timestamp:undefined,platform:'javascript',level:'error',
  release:/^[a-f0-9]{40}$/iu.test(event.release??'')?event.release:undefined,environment:['production','staging','prelaunch-trial'].includes(event.environment??'')?event.environment:undefined,message:code,
  exception:{values:[{type,value:code,...(frames.length?{stacktrace:{frames}}:{})}]},
  tags:{error_code:code,screen,...(component?{component}:{})}};
}
export function sanitizeBreadcrumb(_breadcrumb: Breadcrumb): Breadcrumb|null {return null;}
