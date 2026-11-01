import {DurableObject} from 'cloudflare:workers';
import relay, {RelayInbox as InboxCore, type RelayEnv, type State} from './index';

// Runtime adapter; the core is also exercised against local SQLite in Node.
export class RelayInbox extends DurableObject {
  private core: InboxCore;
  constructor(ctx: State, env: RelayEnv) {super(ctx, env); this.core = new InboxCore(ctx, env);}
  fetch(request: Request): Promise<Response> {return this.core.fetch(request);}
  alarm(): Promise<void> {return this.core.alarm();}
}
export default relay;
