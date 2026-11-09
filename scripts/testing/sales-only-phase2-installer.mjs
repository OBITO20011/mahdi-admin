import {simpleReportSql} from './sales-only-phase2-report.mjs';
import {readFileSync} from 'node:fs';
import {bridgeSql} from './sales-only-phase1-bridges.mjs';
import {commercialSql} from './sales-only-phase2-commercial.mjs';
import {returnSql} from './sales-only-phase2-returns.mjs';
import {statementSql} from './sales-only-phase2-statement.mjs';

/** Builds SQL only. Executors remain in the owned, networkless219 runners.
 * This is not an active migration or an owner/hosted upgrade entrypoint. */
export function phase2PrototypeSql(before){
 const read=name=>readFileSync(new URL('../../docs/design/sales-only-phase'+name,import.meta.url),'utf8');
 return ["BEGIN;SELECT set_config('nawasrah.sales_lite1_test','OWNED_LOCAL_DB219',true);SELECT set_config('nawasrah.sales_lite2_test','OWNED_LOCAL_DB219',true);",
  read('1/prototype.sql'),bridgeSql(before),commercialSql(before),read('2/pos-writer.sql'),read('2/guest-writer.sql'),read('2/guest-lifecycle.sql'),
  read('2/operating-mode.sql'),read('2/availability.sql'),read('2/pos-options.sql'),returnSql(before),read('2/aftercare-context.sql'),statementSql(before),read('2/ledger-readers.sql'),simpleReportSql(before),read('2/simple-home.sql'),read('2/opening-epoch.sql'),read('2/entrypoints.sql'),'COMMIT;'].join('\n');
}
