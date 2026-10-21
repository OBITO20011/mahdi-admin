// One source for routing, discovery and fail-closed delivery verification.
export const packageFShardCount = 5;
export const packageFShards = Object.freeze(Array.from({length: packageFShardCount}, (_, index) => index + 1));
// These existing Package F interface suites keep their historical filenames
// and test identities; share their work across the same five browser shards.
const packageFSpecName = /(?:package-f-[^/\\]+|admin-navigation-cash206|document-corrections207)\.spec\.ts/;
export const packageFSpecPattern = new RegExp(`[/\\\\]${packageFSpecName.source}$`, 'u');
export const notPackageFSpecPattern = new RegExp(`[/\\\\](?!${packageFSpecName.source}$)[^/\\\\]+$`, 'u');
export const isPackageFSpec = file => packageFSpecPattern.test('/' + file.replaceAll('\\', '/'));
export function isPackageFShardArgument(value) {
  return packageFShards.some(shard => value === `--shard=${shard}/${packageFShardCount}`);
}
