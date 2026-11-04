import type {Plugin} from 'vite';
import type {SelectedBuildEnvironment} from './vite-environment.mjs';
export function privateSourceMaps(selected:SelectedBuildEnvironment,root:string,app:'admin'|'customer'):Plugin;
export function privateMapsEnabled(selected:SelectedBuildEnvironment):boolean;
export function assertPrivateMapPath(target:string,dist:string):void;
export function protectMapArchive(directory:string):Promise<void>;
