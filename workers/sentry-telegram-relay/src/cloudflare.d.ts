// Only the base constructor used here; no runtime replacement or polyfill.
declare module 'cloudflare:workers' {
  export class DurableObject {constructor(ctx: unknown, env: unknown);}
}
