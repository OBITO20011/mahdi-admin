const PUBLIC_ROUTE = /^\/(?:$|products\/?$|offers\/?$|about\/?$|product\/[^/]+\/?$|category\/[^/]+\/?$|robots\.txt$|sitemap\.xml$|assets\/|nawasrah-[^/]+\.(?:jpg|webp|mp4)$)/u;

const NOT_FOUND_HTML = `<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex, nofollow, noarchive" />
    <title>الصفحة غير موجودة | محلات النواصرة التجارية</title>
  </head>
  <body style="margin:0;background:#f8fafc;color:#0f172a;font-family:system-ui,sans-serif">
    <main style="min-height:100vh;display:grid;place-items:center;padding:24px;text-align:center">
      <section>
        <h1>الصفحة غير موجودة</h1>
        <p>تأكد من الرابط أو ارجع إلى المتجر.</p>
        <a href="https://alnawasreh.com/">العودة إلى الرئيسية</a>
      </section>
    </main>
  </body>
</html>`;

export async function onRequest(context) {
  const requestUrl = new URL(context.request.url);
  const isReadRequest = context.request.method === 'GET' || context.request.method === 'HEAD';
  if (!isReadRequest || PUBLIC_ROUTE.test(requestUrl.pathname)) return context.next();

  return new Response(context.request.method === 'HEAD' ? null : NOT_FOUND_HTML, {
    status: 404,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/html; charset=UTF-8',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
    },
  });
}
