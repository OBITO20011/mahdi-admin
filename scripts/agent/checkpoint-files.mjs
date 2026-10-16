import {createHash} from 'node:crypto';
// Keep the existing4KB task contract. Large integrations retain EVERY path
// in a separate exact,digested manifest rather than dropping scope or limits.
export const checkpointFilesPath='docs/agent/ACTIVE_TASK_FILES.json';
export function checkpointFileManifest(entries){
 const files=entries.filter(({path})=>!['docs/agent/ACTIVE_TASK.json','docs/agent/HANDOFF_HISTORY.md',checkpointFilesPath].includes(path));
 const text=JSON.stringify({schemaVersion:1,files},null,2)+'\n';
 return {text,filesTouched:[checkpointFilesPath],filesTouchedCount:files.length,
  filesTouchedManifestSha256:createHash('sha256').update(text).digest('hex')};
}
