import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  'supabase/migrations/033_order_web_push_notifications.sql',
  'utf8',
);
const edgeFunction = readFileSync(
  'supabase/functions/send-order-push/index.ts',
  'utf8',
);
const pushService = readFileSync(
  'src/services/pushNotifications.service.ts',
  'utf8',
);
const serviceWorker = readFileSync('public/sw.js', 'utf8');
const productionCleanup = readFileSync(
  'supabase/migrations/035_remove_push_test_controls.sql',
  'utf8',
);

test('push subscriptions are staff-only and written through audited RPCs', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.push_subscriptions/);
  assert.match(migration, /ALTER TABLE public\.push_subscriptions ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.push_subscriptions[\s\S]*authenticated/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.save_push_subscription/);
  assert.match(migration, /PERFORM public\.assert_erp_role/);
  assert.match(migration, /ENABLE_ORDER_PUSH/);
  assert.doesNotMatch(migration, /GRANT EXECUTE[\s\S]{0,150}save_push_subscription[\s\S]{0,80}TO anon/);
});

test('new website orders queue a secret-verified asynchronous Edge Function', () => {
  assert.match(migration, /CREATE EXTENSION IF NOT EXISTS pg_net/);
  assert.match(migration, /vault\.create_secret/);
  assert.match(migration, /net\.http_post/);
  assert.match(migration, /AFTER INSERT ON public\.orders/);
  assert.match(migration, /NEW\.source = 'website'/);
  assert.match(edgeFunction, /x-order-push-secret/);
  assert.match(edgeFunction, /safeEqual\(providedSecret, expectedSecret\)/);
  assert.match(edgeFunction, /WEB_PUSH_VAPID_PRIVATE_KEY/);
  assert.match(edgeFunction, /webpush\.sendNotification/);
  assert.match(edgeFunction, /\[404, 410\]\.includes\(statusCode\)/);
});

test('the admin subscribes through PushManager and Supabase RPC', () => {
  assert.match(pushService, /Notification\.requestPermission\(\)/);
  assert.match(pushService, /pushManager\.subscribe/);
  assert.match(pushService, /userVisibleOnly: true/);
  assert.match(pushService, /applicationServerKey/);
  assert.match(pushService, /supabase\.rpc\('save_push_subscription'/);
  assert.doesNotMatch(pushService, /send_test_push_notification/);
});

test('production push accepts new website orders only', () => {
  assert.match(edgeFunction, /type: 'new_order'/);
  assert.doesNotMatch(edgeFunction, /type: 'new_order' \| 'test'/);
  assert.match(productionCleanup, /DROP FUNCTION IF EXISTS public\.send_test_push_notification/);
  assert.match(productionCleanup, /CHECK \(event_type = 'new_order'\)/);
});

test('the service worker displays and routes background notifications', () => {
  assert.match(serviceWorker, /addEventListener\('push'/);
  assert.match(serviceWorker, /showNotification/);
  assert.match(serviceWorker, /addEventListener\('notificationclick'/);
  assert.match(serviceWorker, /clients\.openWindow/);
});
