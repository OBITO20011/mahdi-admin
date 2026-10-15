// One-time data bootstrap,not a public RPC or a schema/permission change.
import assert from 'node:assert/strict';
import {uuid,sqlLiteral as q} from './trial-reset-core.mjs';
export function validateFirstOwner(value){
 uuid(value.ownerId);
 for(const key of ['email','name','branchCode','branchName'])assert.equal(typeof value[key],'string','FIRST_OWNER_REQUIRED:'+key);
 assert.match(value.email,/^[^\s@]+@[^\s@]+\.[^\s@]+$/u);assert.ok(value.email.length<=254);
 assert.ok(value.name.trim().length>=2&&value.name.length<=120,'FIRST_OWNER_NAME');
 assert.match(value.branchCode,/^[A-Z0-9_-]{1,32}$/u,'FIRST_OWNER_BRANCH_CODE');
 assert.ok(value.branchName.trim().length>=2&&value.branchName.length<=120,'FIRST_OWNER_BRANCH_NAME');
 return {...value,email:value.email.trim().toLowerCase(),name:value.name.trim(),branchName:value.branchName.trim()};
}
export function bindFirstOwnerSql(input){
 const p=validateFirstOwner(input);
 return `BEGIN ISOLATION LEVEL SERIALIZABLE;SET LOCAL search_path=public,pg_temp;
 DO $first_owner$ DECLARE b uuid;owner_role uuid;u auth.users%ROWTYPE;BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('nawasrah-first-owner-bootstrap'));
 SELECT * INTO STRICT u FROM auth.users WHERE id=${q(p.ownerId)}::uuid FOR UPDATE;
 IF lower(u.email)<>${q(p.email)} OR u.email_confirmed_at IS NULL OR COALESCE(u.banned_until>NOW(),false)
 OR to_jsonb(u)->>'deleted_at' IS NOT NULL THEN RAISE EXCEPTION 'FIRST_OWNER_AUTH_IDENTITY_NOT_CONFIRMED';END IF;
 IF EXISTS(SELECT 1 FROM public.profiles) OR EXISTS(SELECT 1 FROM public.user_roles) THEN
  IF (SELECT count(*) FROM public.profiles)=1 AND (SELECT count(*) FROM public.user_roles)=1 AND EXISTS(
   SELECT 1 FROM public.profiles p JOIN public.user_roles ur ON ur.user_id=p.id JOIN public.roles r ON r.id=ur.role_id
   JOIN public.branches b ON b.id=p.branch_id WHERE p.id=u.id AND p.is_active AND p.full_name=${q(p.name)}
   AND r.code='owner' AND b.code=${q(p.branchCode)} AND b.name_ar=${q(p.branchName)} AND b.is_active)
  THEN RETURN;END IF;
  RAISE EXCEPTION 'FIRST_OWNER_ALREADY_INITIALIZED';
 END IF;
 IF EXISTS(SELECT 1 FROM public.orders) OR EXISTS(SELECT 1 FROM public.inventory_movements)
 OR EXISTS(SELECT 1 FROM public.supplier_payments) OR EXISTS(SELECT 1 FROM public.customer_payments)
 THEN RAISE EXCEPTION 'FIRST_OWNER_REQUIRES_UNUSED_BUSINESS';END IF;
 SELECT id INTO b FROM public.branches WHERE code=${q(p.branchCode)} AND is_active AND name_ar=${q(p.branchName)};
 IF b IS NULL THEN
  IF EXISTS(SELECT 1 FROM public.branches) THEN RAISE EXCEPTION 'FIRST_OWNER_BRANCH_MISMATCH';END IF;
  INSERT INTO public.branches(code,name_ar,is_active) VALUES(${q(p.branchCode)},${q(p.branchName)},true) RETURNING id INTO b;
 END IF;
 INSERT INTO public.roles(code,name_ar) VALUES('owner','المالك') ON CONFLICT(code) DO NOTHING;
 SELECT id INTO STRICT owner_role FROM public.roles WHERE code='owner';
 INSERT INTO public.profiles(id,full_name,is_active,branch_id,job_title) VALUES(u.id,${q(p.name)},true,b,'المالك');
 INSERT INTO public.user_roles(user_id,role_id) VALUES(u.id,owner_role);
 INSERT INTO public.audit_logs(user_id,action,entity_name,entity_id,details)
 VALUES(u.id,'FIRST_OWNER_BOOTSTRAP','staff_account',u.id,jsonb_build_object('role','owner','branch_id',b));
 END $first_owner$;
 SELECT jsonb_build_object('ok',true,'owners',(SELECT count(*) FROM public.profiles p JOIN public.user_roles ur ON ur.user_id=p.id JOIN public.roles r ON r.id=ur.role_id WHERE r.code='owner' AND p.is_active));
 COMMIT;`;
}
