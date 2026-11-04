// Test-entry delegates to exact, independently reproduced Git63 views.
// No owner dependency or default/current inventory/coverage verifier changes.
import{sourceBefore198Presentation as original198,inventoryBefore198Presentation as originalInventory198}from'../audit/source-before198-presentation.mjs';
import{projectHistoricalWarehouseQuerySites as originalSites}from'../audit/historical-warehouse-query-sites.mjs';
import{verifyProbeCoverage}from'../audit/table-access-probes.mjs';
import{historicalProductWorkbookHashes,historicalProductWorkbookQuery,historicalProductWorkbookInventory}from'../audit/source-before-product-workbook.mjs';
export{restore198CollectionPresentation}from'../audit/source-before198-presentation.mjs';
export function sourceBefore198Presentation(rows){return historicalProductWorkbookHashes(original198,rows);}
export function inventoryBefore198Presentation(){return historicalProductWorkbookInventory(originalInventory198);}
export function verifyHistoricalWarehouseCoverage(source,results){return verifyProbeCoverage(historicalProductWorkbookQuery(originalSites,source),results);}
export function projectHistoricalWarehouseQuerySites(source){return historicalProductWorkbookQuery(originalSites,source);}

import{verifiedInventoryBeforeTrialR as originalVerifiedR,inventoryBeforeTrialR as originalInventoryR}from'../audit/source-before-trial-owner-r.mjs';
export async function verifiedInventoryBeforeTrialR(){await originalVerifiedR();return historicalProductWorkbookInventory(originalInventoryR);}
