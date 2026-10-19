// Compose the two reviewed data bootstraps atomically. Preserve their complete
// DO bodies byte for byte; strip only their asserted transaction/result frames.
import assert from 'node:assert/strict';
import {bindFirstOwnerSql,validateFirstOwner} from './first-owner-core.mjs';
import {mainWarehouseSql} from './main-warehouse-core.mjs';
const begin='BEGIN ISOLATION LEVEL SERIALIZABLE;SET LOCAL search_path=public,pg_temp;';
function body(sql,marker){
  assert.ok(sql.startsWith(begin),'BOOTSTRAP_TRANSACTION_FRAME_CHANGED');
  assert.ok(sql.endsWith('\n COMMIT;'),'BOOTSTRAP_COMMIT_FRAME_CHANGED');
  const result=sql.lastIndexOf('\n SELECT jsonb_build_object(');
  assert.ok(result>begin.length&&sql.slice(begin.length,result).includes(marker),'BOOTSTRAP_RESULT_FRAME_CHANGED');
  return sql.slice(begin.length,result);
}
export function bindFirstOwnerAndWarehouseSql(input){
  const p=validateFirstOwner(input);
  const owner=body(bindFirstOwnerSql(p),'END $first_owner$;');
  const warehouse=body(mainWarehouseSql(p.ownerId,{branchCode:p.branchCode,branchName:p.branchName}),'END $main_warehouse$;');
  return begin+owner+warehouse+`
 SELECT jsonb_build_object('ok',true,'owners',(SELECT count(*) FROM public.profiles p
 JOIN public.user_roles ur ON ur.user_id=p.id JOIN public.roles r ON r.id=ur.role_id WHERE r.code='owner' AND p.is_active),
 'warehouseReady',EXISTS(SELECT 1 FROM public.warehouses WHERE code='WH-MAIN' AND is_active));
 COMMIT;`;
}
