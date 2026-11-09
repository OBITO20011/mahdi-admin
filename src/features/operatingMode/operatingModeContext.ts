import {createContext,useContext} from 'react';
import type {ModeSnapshot} from './modeReader';

interface OperatingContext extends ModeSnapshot {verified:boolean;refresh:()=>Promise<void>}
export const OperatingModeContext=createContext<OperatingContext|null>(null);
export function useOperatingMode(){
 const value=useContext(OperatingModeContext);
 if(!value)throw Error('OPERATING_MODE_PROVIDER_REQUIRED');
 return value;
}
