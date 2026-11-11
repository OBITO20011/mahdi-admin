import {createRoot} from 'react-dom/client';
import '../src/index.css';
import {OperatingModeProvider} from '../src/features/operatingMode/OperatingModeProvider';
import {OperatingModePanel} from '../src/features/operatingMode/OperatingModePanel';
import {useOperatingMode} from '../src/features/operatingMode/operatingModeContext';
import {authStoreEngine,type AuthState} from '../src/stores/useAuthStore';
import {storeEngine,useAppStoreSelector} from '../src/stores/useAppStore';
import {NavigationShell} from '../src/components/layout/NavigationShell';
import {SideNav} from '../src/components/layout/SideNav';
import {MoreMenuView} from '../src/features/more/MoreMenuView';
import {BottomTabs} from '../src/components/layout/BottomTabs';
const role=new URLSearchParams(location.search).get('role')??'owner';
const engine=authStoreEngine as unknown as {state:AuthState;getState:()=>AuthState;initAuth:()=>Promise<void>};
engine.state={...engine.getState(),user:{id:'92600000-0000-4000-8000-000000000001'} as AuthState['user'],roleName:role,roles:[role],isAuthenticated:true,isLoading:false};
engine.initAuth=async()=>undefined;
storeEngine.setCurrentUser({id:'92600000-0000-4000-8000-000000000001',name:'مالك اختبار',role:role==='owner'?'Owner':'View Only',themeMode:'light'});
storeEngine.setActiveTab('more');
function Harness(){
 const mode=useOperatingMode(),tab=useAppStoreSelector(s=>s.activeTab);
 if(!mode.mode)return <p role="status">جارٍ التحقق من الوضع</p>;
 return <NavigationShell operatingMode={mode.mode}>
  <div className="flex"><SideNav operatingMode={mode.mode}/><main><p data-testid="active-screen">{tab}</p><OperatingModePanel/><MoreMenuView operatingMode={mode.mode}/></main></div>
  <div className="lg:hidden"><BottomTabs operatingMode={mode.mode}/></div>
 </NavigationShell>;
}
createRoot(document.getElementById('root')!).render(<OperatingModeProvider><Harness/></OperatingModeProvider>);
