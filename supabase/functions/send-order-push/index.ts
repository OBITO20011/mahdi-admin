import {createClient} from 'npm:@supabase/supabase-js@2.110.8';
import webpush from 'npm:web-push@3.6.7';

interface PushWebhookBody {
  type: 'new_order';
  orderId: string;
  eventKey: string;
}

interface PushTarget {
  subscription_id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth_key: string;
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {'Content-Type': 'application/json; charset=utf-8'},
  });

const safeEqual = (left: string, right: string) => {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
};

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return jsonResponse({error: 'Method not allowed'}, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const vapidPublicKey = Deno.env.get('WEB_PUSH_VAPID_PUBLIC_KEY');
  const vapidPrivateKey = Deno.env.get('WEB_PUSH_VAPID_PRIVATE_KEY');
  const vapidSubject = Deno.env.get('WEB_PUSH_SUBJECT');

  if (
    !supabaseUrl ||
    !serviceRoleKey ||
    !vapidPublicKey ||
    !vapidPrivateKey ||
    !vapidSubject
  ) {
    return jsonResponse({error: 'Push service is not configured'}, 503);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {persistSession: false, autoRefreshToken: false},
  });

  const {data: expectedSecret, error: secretError} = await supabase.rpc(
    'get_push_webhook_secret',
  );
  const providedSecret = request.headers.get('x-order-push-secret') || '';

  if (
    secretError ||
    typeof expectedSecret !== 'string' ||
    !safeEqual(providedSecret, expectedSecret)
  ) {
    return jsonResponse({error: 'Unauthorized'}, 401);
  }

  let body: PushWebhookBody;
  try {
    body = (await request.json()) as PushWebhookBody;
  } catch {
    return jsonResponse({error: 'Invalid JSON payload'}, 400);
  }

  if (
    !body.eventKey ||
    body.type !== 'new_order' ||
    !body.orderId
  ) {
    return jsonResponse({error: 'Invalid push event'}, 400);
  }

  const {error: dispatchInsertError} = await supabase
    .from('push_dispatches')
    .insert({
      event_key: body.eventKey,
      event_type: body.type,
      entity_id: body.orderId,
      status: 'processing',
    });

  if (dispatchInsertError?.code === '23505') {
    return jsonResponse({success: true, duplicate: true});
  }
  if (dispatchInsertError) {
    return jsonResponse({error: dispatchInsertError.message}, 500);
  }

  const {data: order, error: orderError} = await supabase
    .from('orders')
    .select(
      'id, order_number, customer_name_snapshot, total_in_minor_units, status, source',
    )
    .eq('id', body.orderId)
    .eq('source', 'website')
    .single();

  if (orderError || !order) {
    await supabase
      .from('push_dispatches')
      .update({
        status: 'failed',
        failed_count: 1,
        last_error: orderError?.message || 'Order not found',
        completed_at: new Date().toISOString(),
      })
      .eq('event_key', body.eventKey);
    return jsonResponse({error: 'Order not found'}, 404);
  }

  const total = (Number(order.total_in_minor_units || 0) / 1000).toFixed(3);
  const title = `طلب جديد ${order.order_number}`;
  const message = `${order.customer_name_snapshot || 'عميل جديد'} — ${total} د.أ`;
  const targetUrl = `/?screen=orders&order=${encodeURIComponent(order.id)}`;
  const tag = `new-order-${order.id}`;

  const {data: targets, error: targetsError} = await supabase.rpc(
    'get_active_order_push_targets',
    {p_user_id: null},
  );

  if (targetsError) {
    await supabase
      .from('push_dispatches')
      .update({
        status: 'failed',
        failed_count: 1,
        last_error: targetsError.message,
        completed_at: new Date().toISOString(),
      })
      .eq('event_key', body.eventKey);
    return jsonResponse({error: targetsError.message}, 500);
  }

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

  const payload = JSON.stringify({
    title,
    body: message,
    tag,
    icon: '/icons/admin-icon-192.png',
    badge: '/icons/admin-icon-192.png',
    data: {url: targetUrl, orderId: body.orderId},
  });

  let deliveredCount = 0;
  let failedCount = 0;

  for (const target of (targets || []) as PushTarget[]) {
    try {
      await webpush.sendNotification(
        {
          endpoint: target.endpoint,
          keys: {p256dh: target.p256dh, auth: target.auth_key},
        },
        payload,
        {TTL: 120, urgency: 'high'},
      );
      deliveredCount += 1;
      await supabase
        .from('push_subscriptions')
        .update({
          failure_count: 0,
          last_success_at: new Date().toISOString(),
          last_failure_message: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', target.subscription_id);
    } catch (error) {
      failedCount += 1;
      const statusCode = Number((error as {statusCode?: number})?.statusCode || 0);
      const failureMessage = String(
        (error as {message?: string})?.message || 'Push delivery failed',
      ).slice(0, 500);
      await supabase
        .from('push_subscriptions')
        .update({
          is_active: ![404, 410].includes(statusCode),
          failure_count: 1,
          last_failure_at: new Date().toISOString(),
          last_failure_message: failureMessage,
          updated_at: new Date().toISOString(),
        })
        .eq('id', target.subscription_id);
    }
  }

  const status =
    deliveredCount > 0 && failedCount === 0
      ? 'sent'
      : deliveredCount > 0
        ? 'partial'
        : 'failed';

  await supabase
    .from('push_dispatches')
    .update({
      status,
      delivered_count: deliveredCount,
      failed_count: failedCount,
      last_error:
        deliveredCount === 0 && failedCount === 0
          ? 'No active push subscriptions'
          : null,
      completed_at: new Date().toISOString(),
    })
    .eq('event_key', body.eventKey);

  return jsonResponse({
    success: deliveredCount > 0,
    delivered: deliveredCount,
    failed: failedCount,
  });
});
