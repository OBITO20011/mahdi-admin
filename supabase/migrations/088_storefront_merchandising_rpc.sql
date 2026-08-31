BEGIN;

-- The home page needs four independently ranked, bounded rails. Keep the
-- established family-safe catalog contract as the source of truth, but return
-- all rails through one public RPC so the browser does not make four requests.
CREATE OR REPLACE FUNCTION public.get_public_storefront_merchandising()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'newest', COALESCE(
      public.get_public_storefront_catalog_page(
        6, 0, NULL::UUID, NULL::TEXT, 'all', 'newest',
        NULL::UUID, NULL::UUID, NULL::UUID[]
      )->'items',
      '[]'::JSONB
    ),
    'bestSellers', COALESCE(
      public.get_public_storefront_catalog_page(
        6, 0, NULL::UUID, NULL::TEXT, 'all', 'best_sellers',
        NULL::UUID, NULL::UUID, NULL::UUID[]
      )->'items',
      '[]'::JSONB
    ),
    'offers', COALESCE(
      public.get_public_storefront_catalog_page(
        6, 0, NULL::UUID, NULL::TEXT, 'all', 'offers',
        NULL::UUID, NULL::UUID, NULL::UUID[]
      )->'items',
      '[]'::JSONB
    ),
    'lowStock', COALESCE(
      public.get_public_storefront_catalog_page(
        6, 0, NULL::UUID, NULL::TEXT, 'all', 'low_stock',
        NULL::UUID, NULL::UUID, NULL::UUID[]
      )->'items',
      '[]'::JSONB
    )
  );
$$;

REVOKE ALL ON FUNCTION public.get_public_storefront_merchandising() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_storefront_merchandising() TO anon, authenticated;

COMMENT ON FUNCTION public.get_public_storefront_merchandising() IS
  'Public bounded home merchandising response. Returns up to six family-safe catalog cards per rail without catalog facets or supplier/cost data.';

COMMIT;
