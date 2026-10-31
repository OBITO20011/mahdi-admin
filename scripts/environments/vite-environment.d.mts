import type {Plugin} from 'vite';
export interface SelectedBuildEnvironment {
 format:number;environment:string;isolated:boolean;projectRef:string|null;
 monitoring:{dsn:string;ingestOrigin:string;release:string};
 url:string;key:string;storeOrigin:string;turnstile:string;
}
export function selectedViteEnvironment(mode:string,root:string):SelectedBuildEnvironment;
export function environmentDefines(selected:SelectedBuildEnvironment):Record<string,string>;
export function environmentAssets(selected:SelectedBuildEnvironment,root:string):Plugin;
