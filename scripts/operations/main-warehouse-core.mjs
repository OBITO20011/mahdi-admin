// Owner-only data bootstrap. No RPC,DDL,grant or business movement is added.
import {uuid,sqlLiteral as q} from './trial-reset-core.mjs';
export const mainWarehouse=Object.freeze({code:'WH-MAIN',name:'المستودع الرئيسي',branchCode:'BR-MAIN',branchName:'الفرع الرئيسي'});
export function mainWarehouseSql(ownerId){
 uuid(ownerId);
 return `BEGIN ISOLATION LEVEL SERIALIZABLE;SET LOCAL search_path=public,pg_temp;
 DO $main_warehouse$ DECLARE b uuid;w public.warehouses%ROWTYPE;BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('nawasrah-main-warehouse-bootstrap'));
 PERFORM p.id FROM public.profiles p JOIN auth.users u ON u.id=p.id
 JOIN public.user_roles ur ON ur.user_id=p.id JOIN public.roles r ON r.id=ur.role_id
 WHERE p.id=${q(ownerId)}::uuid AND p.is_active AND r.code='owner'
 AND u.email_confirmed_at IS NOT NULL AND NOT COALESCE(u.banned_until>NOW(),false)
 AND to_jsonb(u)->>'deleted_at' IS NULL FOR UPDATE OF p,u,ur;
 IF NOT FOUND THEN RAISE EXCEPTION 'MAIN_WAREHOUSE_OWNER_REQUIRED';END IF;
 SELECT id INTO b FROM public.branches WHERE code=${q(mainWarehouse.branchCode)}
 AND name_ar=${q(mainWarehouse.branchName)} AND is_active FOR UPDATE;
 IF b IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=${q(ownerId)}::uuid AND branch_id=b)
 THEN RAISE EXCEPTION 'MAIN_WAREHOUSE_BRANCH_MISMATCH';END IF;
 LOCK TABLE public.warehouses IN SHARE ROW EXCLUSIVE MODE;
 IF EXISTS(SELECT 1 FROM public.warehouses) THEN
  IF (SELECT count(*) FROM public.warehouses)<>1 THEN RAISE EXCEPTION 'MAIN_WAREHOUSE_DIFFERENT_WAREHOUSE';END IF;
  SELECT * INTO STRICT w FROM public.warehouses;
  IF w.code<>${q(mainWarehouse.code)} OR w.name_ar<>${q(mainWarehouse.name)}
  OR w.branch_id IS DISTINCT FROM b OR w.is_active IS DISTINCT FROM true
  THEN RAISE EXCEPTION 'MAIN_WAREHOUSE_DIFFERENT_WAREHOUSE';END IF;
  RETURN;
 END IF;
 INSERT INTO public.warehouses(code,name_ar,branch_id,is_active)
 VALUES(${q(mainWarehouse.code)},${q(mainWarehouse.name)},b,true) RETURNING * INTO w;
 INSERT INTO public.audit_logs(user_id,action,entity_name,entity_id,details)
 VALUES(${q(ownerId)}::uuid,'MAIN_WAREHOUSE_BOOTSTRAP','warehouses',w.id,
 jsonb_build_object('code',w.code,'name_ar',w.name_ar,'branch_id',b,'branch_code',${q(mainWarehouse.branchCode)}));
 END $main_warehouse$;
 SELECT jsonb_build_object('ok',true,'warehouse',(SELECT to_jsonb(w) FROM public.warehouses w WHERE code=${q(mainWarehouse.code)}));
 COMMIT;`;
}
