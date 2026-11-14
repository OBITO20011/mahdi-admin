// One source for routing, discovery and fail-closed delivery verification.
export const packageFShardCount = 10;
export const packageFShards = Object.freeze(Array.from({length: packageFShardCount}, (_, index) => index + 1));
// These existing Package F interface suites keep their historical filenames
// and test identities; share their work across the approved browser shards.
// The two price-card suites are product-interface cases too. Keep every test
// identity and the existing ten shards;do not add work to the20m core engine.
const packageFSpecName = /(?:package-f-[^/\\]+|admin-navigation-cash206|document-corrections207|off-product-prices|price-visibility)\.spec\.ts/;
export const packageFSpecPattern = new RegExp(`[/\\\\]${packageFSpecName.source}$`, 'u');
export const notPackageFSpecPattern = new RegExp(`[/\\\\](?!${packageFSpecName.source}$)[^/\\\\]+$`, 'u');
export const isPackageFSpec = file => packageFSpecPattern.test('/' + file.replaceAll('\\', '/'));
export function isPackageFShardArgument(value) {
  return packageFShards.some(shard => value === `--shard=${shard}/${packageFShardCount}`);
}
