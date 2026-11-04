import {useLayoutEffect,useRef} from 'react';
import type {ActiveTab} from '../stores/appStorePreferences';
import {registerScreenLeaveGuard} from '../utils/screenHistory';

export function useScreenLeaveGuard(tab:ActiveTab,allow:()=>boolean){
 const latest=useRef(allow);latest.current=allow;
 useLayoutEffect(()=>registerScreenLeaveGuard(tab,()=>latest.current()),[tab]);
}
