import {createContext, useContext} from 'react';

export interface NavigationDrawerState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  entryIntent: {type:'customer_return'|'owner_withdrawals'|'inventory_low';request:number}|null;
  setEntryIntent: (type:'customer_return'|'owner_withdrawals'|'inventory_low'|null) => void;
}

export const NavigationDrawerContext = createContext<NavigationDrawerState | null>(null);
export const useNavigationDrawer = () => useContext(NavigationDrawerContext);
