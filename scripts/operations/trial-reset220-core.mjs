// Separate post-launch220 policy.219 entrypoints and their contracts remain intact.
import {captureRetainedReset,runRetainedReset} from './trial-reset214-core.mjs';
import {assertCurrentResetReference} from './operational-schema.mjs';
import {assertReady220Catalog} from './frankfurt-reference220.mjs';
import {verifyExistingReset220Cron,guardedReset220CronUnits,verifyReset220MigrationManifest} from './reset220-pg-cron-guard.mjs';
const policy=Object.freeze({ceiling:220,files:181,assertCatalog:assertReady220Catalog,
 verifyExistingCron:verifyExistingReset220Cron,guardedCronUnits:guardedReset220CronUnits,
 verifyMigrationManifest:verifyReset220MigrationManifest});
export const captureReset220=options=>{assertCurrentResetReference(options.reference);return captureRetainedReset(options,policy);};
export const reset220WithExecutor=options=>{assertCurrentResetReference(options.reference);return runRetainedReset(options,policy);};
