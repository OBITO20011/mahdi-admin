import {executeInput as nativeInput} from './build-empty-supabase.mjs';
// In-process transport is solely a local-test seam. The owner CLI constructs
// only native executors;there is no command-line transport/host override.
export async function executeResetInput(executor,input){
 if(executor.localOnly===true&&typeof executor.localExecute==='function')return executor.localExecute(String(input),executor.reset214Writer??'');
 return nativeInput(executor,input);
}
