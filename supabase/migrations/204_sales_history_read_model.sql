-- Owner21/22:all invoice history,not the operational website queue.
-- Read evidence only. No invented completion and no financial writer changes.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_sales_history_page(
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 25,
  p_period TEXT DEFAULT 'day',
  p_from_date DATE DEFAULT NULL,
  p_to_date DATE DEFAULT NULL,
  p_payment_method TEXT DEFAULT 'all',
  p_source TEXT DEFAULT 'all',
  p_customer_search TEXT DEFAULT NULL,
  p_number_search TEXT DEFAULT NULL,
  p_sales_only BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_page INTEGER := COALESCE(p_page,1);
  v_size INTEGER := COALESCE(p_page_size,25);
  v_period TEXT := COALESCE(NULLIF(BTRIM(p_period),''),'day');
  v_method TEXT := COALESCE(NULLIF(BTRIM(p_payment_method),''),'all');
  v_source TEXT := COALESCE(NULLIF(BTRIM(p_source),''),'all');
  v_customer TEXT := NULLIF(BTRIM(p_customer_search),'');
  v_number TEXT := NULLIF(BTRIM(p_number_search),'');
  v_today DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Amman')::DATE;
  v_from DATE;
  v_to DATE;
  v_start TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
  v_result JSONB;
BEGIN
  PERFORM public.assert_erp_role(
    ARRAY['owner','admin','manager','accountant','cashier','sales','orders','delivery_driver'],
    'عرض سجل المبيعات'
  );
  IF v_page<1 OR v_page>100000 OR v_size<1 OR v_size>100 THEN
    RAISE EXCEPTION 'رقم الصفحة أو حجمها غير صالح.';
  END IF;
  IF v_period NOT IN ('day','week','month','range','all') THEN
    RAISE EXCEPTION 'فترة سجل المبيعات غير صالحة.';
  END IF;
  IF v_method NOT IN ('all','cash','cliq','bank_transfer','cheque','card','debt','mixed','unknown')
     OR v_source NOT IN ('all','pos','website','unknown') THEN
    RAISE EXCEPTION 'فلتر الدفع أو المصدر غير صالح.';
  END IF;
  IF CHAR_LENGTH(v_customer)>100 OR CHAR_LENGTH(v_number)>100 THEN
    RAISE EXCEPTION 'عبارة البحث طويلة جداً.';
  END IF;
  IF v_period='range' THEN
    IF p_from_date IS NULL OR p_to_date IS NULL OR NOT isfinite(p_from_date)
      OR NOT isfinite(p_to_date) OR p_from_date>p_to_date THEN
      RAISE EXCEPTION 'اختر مدى تاريخ صحيحاً.';
    END IF;
    v_from:=p_from_date;v_to:=p_to_date;
  ELSE
    IF p_from_date IS NOT NULL OR p_to_date IS NOT NULL THEN
      RAISE EXCEPTION 'التواريخ المخصصة تتطلب اختيار مدى.';
    END IF;
    v_from:=CASE v_period WHEN 'day' THEN v_today WHEN 'week' THEN v_today-6
      WHEN 'month' THEN date_trunc('month',v_today)::DATE ELSE NULL END;
    v_to:=CASE WHEN v_period='all' THEN NULL ELSE v_today END;
  END IF;
  v_start:=v_from::TIMESTAMP AT TIME ZONE 'Asia/Amman';
  v_end:=(v_to+1)::TIMESTAMP AT TIME ZONE 'Asia/Amman';

  WITH first_completion AS MATERIALIZED (
    SELECT h.order_id,MIN(h.created_at) AS at
    FROM public.order_status_history h WHERE h.new_status='completed'
    GROUP BY h.order_id
  ), evidence AS (
    SELECT o.id,o.order_number,o.total_in_minor_units,o.payment_method,o.payment_status,
      o.source,o.status,o.created_at,fc.at AS first_completed_at,
      COALESCE(fc.at,o.created_at) AS listed_at,
      (fc.at IS NOT NULL AND o.status IN ('completed','returned')) AS counts_as_sale,
      COALESCE(NULLIF(BTRIM(o.customer_name_snapshot),''),NULLIF(BTRIM(c.full_name),''),'زبون نقدي') AS customer_name,
      COALESCE(c.phone,'') AS customer_phone
    FROM public.orders o
    LEFT JOIN first_completion fc ON fc.order_id=o.id
    LEFT JOIN public.customers c ON c.id=o.customer_id
    WHERE (v_method='all' OR o.payment_method::TEXT=v_method
      OR (v_method='cash' AND o.payment_method::TEXT='cash_on_delivery')
      OR (v_method='unknown' AND (o.payment_method IS NULL OR o.payment_method::TEXT NOT IN
        ('cash','cash_on_delivery','cliq','bank_transfer','cheque','card','debt','mixed'))))
      AND (v_source='all' OR o.source=v_source
        OR (v_source='unknown' AND (o.source IS NULL OR o.source NOT IN ('pos','website'))))
      AND (v_customer IS NULL OR strpos(lower(COALESCE(o.customer_name_snapshot,'')),lower(v_customer))>0
        OR strpos(lower(COALESCE(c.full_name,'')),lower(v_customer))>0
        OR strpos(COALESCE(c.phone,''),v_customer)>0)
      AND (v_number IS NULL OR strpos(lower(COALESCE(o.order_number,'')),lower(v_number))>0)
  ), filtered AS MATERIALIZED (
    SELECT * FROM evidence
    WHERE (v_start IS NULL OR listed_at>=v_start) AND (v_end IS NULL OR listed_at<v_end)
      AND (NOT COALESCE(p_sales_only,false) OR counts_as_sale)
  ), totals AS (
    SELECT COUNT(*) AS invoice_count,COUNT(*) FILTER(WHERE counts_as_sale) AS sale_count,
      COALESCE(SUM(total_in_minor_units) FILTER(WHERE counts_as_sale),0)::BIGINT AS sales,
      COUNT(*) FILTER(WHERE first_completed_at IS NULL AND status IN ('completed','returned')) AS undated_count
    FROM filtered
  ), page_rows AS (
    SELECT * FROM filtered ORDER BY listed_at DESC,id DESC
    OFFSET ((v_page-1)*v_size) LIMIT v_size
  )
  SELECT jsonb_build_object(
    'success',true,'generatedAt',CURRENT_TIMESTAMP,'timeZone','Asia/Amman',
    'page',v_page,'pageSize',v_size,'totalCount',t.invoice_count,
    'totalPages',GREATEST(1,CEIL(t.invoice_count::NUMERIC/v_size)::INTEGER),
    'period',jsonb_build_object('kind',v_period,'fromDate',v_from,'toDate',v_to),
    'summary',jsonb_build_object('invoiceCount',t.invoice_count,'salesCount',t.sale_count,
      'salesInMinorUnits',t.sales,'undatedInvoiceCount',t.undated_count),
    'rows',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id',r.id,'orderNumber',r.order_number,'listedAt',r.listed_at,
      'firstCompletedAt',r.first_completed_at,'dateBasis',CASE WHEN r.first_completed_at IS NULL THEN 'creation' ELSE 'completion' END,
      'customerName',r.customer_name,'customerPhone',r.customer_phone,
      'totalInMinorUnits',r.total_in_minor_units,'paymentMethod',r.payment_method,
      'paymentStatus',r.payment_status,'source',r.source,'status',r.status,
      'countsAsSale',r.counts_as_sale) ORDER BY r.listed_at DESC,r.id DESC) FROM page_rows r),'[]'::JSONB)
  ) INTO v_result FROM totals t;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_sales_history_page(INTEGER,INTEGER,TEXT,DATE,DATE,TEXT,TEXT,TEXT,TEXT,BOOLEAN)
  FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_sales_history_page(INTEGER,INTEGER,TEXT,DATE,DATE,TEXT,TEXT,TEXT,TEXT,BOOLEAN)
  TO authenticated;
COMMIT;
