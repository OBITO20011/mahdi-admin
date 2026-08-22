import {createClient} from 'npm:@supabase/supabase-js@2.110.8';

type AutomationChannel = 'telegram' | 'whatsapp';

interface FeedBody {
  action?: 'health' | 'claim' | 'complete';
  channel?: AutomationChannel;
  limit?: number;
  leaseSeconds?: number;
  eventId?: string;
  success?: boolean;
  error?: string;
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });

const safeEqual = (left: string, right: string) => {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
};

const isChannel = (value: unknown): value is AutomationChannel =>
  value === 'telegram' || value === 'whatsapp';

const isUuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return jsonResponse({error: 'Method not allowed'}, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const expectedSecret = Deno.env.get('NAWASRAH_AUTOMATION_SECRET');
  const providedSecret =
    request.headers.get('x-nawasrah-automation-secret') || '';

  if (!supabaseUrl || !serviceRoleKey || !expectedSecret) {
    return jsonResponse({error: 'Automation feed is not configured'}, 503);
  }
  if (!safeEqual(providedSecret, expectedSecret)) {
    return jsonResponse({error: 'Unauthorized'}, 401);
  }

  let body: FeedBody;
  try {
    body = (await request.json()) as FeedBody;
  } catch {
    return jsonResponse({error: 'Invalid JSON payload'}, 400);
  }

  if (body.action === 'health') {
    return jsonResponse({success: true, service: 'n8n-alert-feed'});
  }
  if (!isChannel(body.channel)) {
    return jsonResponse({error: 'Invalid delivery channel'}, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {persistSession: false, autoRefreshToken: false},
  });

  if (body.action === 'claim') {
    const limit = Number.isInteger(body.limit)
      ? Math.min(Math.max(body.limit as number, 1), 50)
      : 10;
    const leaseSeconds = Number.isInteger(body.leaseSeconds)
      ? Math.min(Math.max(body.leaseSeconds as number, 30), 900)
      : 120;
    const {data, error} = await supabase.rpc('claim_automation_deliveries', {
      p_channel: body.channel,
      p_limit: limit,
      p_lease_seconds: leaseSeconds,
    });

    if (error) {
      console.error('Automation claim failed', error.code);
      return jsonResponse({error: 'Unable to claim automation events'}, 500);
    }
    return jsonResponse(data);
  }

  if (body.action === 'complete') {
    if (!isUuid(body.eventId) || typeof body.success !== 'boolean') {
      return jsonResponse({error: 'Invalid delivery completion'}, 400);
    }
    const {data, error} = await supabase.rpc('complete_automation_delivery', {
      p_event_id: body.eventId,
      p_channel: body.channel,
      p_success: body.success,
      p_error:
        typeof body.error === 'string' ? body.error.slice(0, 1000) : null,
    });

    if (error) {
      console.error('Automation completion failed', error.code);
      return jsonResponse({error: 'Unable to complete automation event'}, 409);
    }
    return jsonResponse(data);
  }

  return jsonResponse({error: 'Invalid action'}, 400);
});
