import {UiButton} from '../../components/ui';
import {useAuthStore} from '../../stores/useAuthStore';
import {useAppStoreActions} from '../../stores/useAppStore';
import {useNavigationDrawer} from '../../components/layout/navigationDrawerContext';
export function LowOptionalQuantityList(){
 const auth=useAuthStore(),{setActiveTab}=useAppStoreActions(),drawer=useNavigationDrawer();
 if(auth.roleName!=='owner'&&!auth.roles.includes('owner'))return null;
 return <UiButton type="button" variant="secondary" onClick={()=>{drawer?.setEntryIntent('inventory_low');setActiveTab('inventory');}}>أصناف قرب تخلص</UiButton>;
}
