// One source for routing, discovery and fail-closed delivery verification.
export const packageFShardCount = 5;
export const packageFShards = Object.freeze(Array.from({length: packageFShardCount}, (_, index) => index + 1));
export function isPackageFShardArgument(value) {
  return packageFShards.some(shard => value === `--shard=${shard}/${packageFShardCount}`);
}
