import { ROLE_PERMISSIONS_MAP } from '../../constants';
import { Branch, Role, User } from '../../types';
import { isSupabaseConfigured, supabase } from '../../lib/supabase';

export type StaffRoleCode =
  | 'admin'
  | 'manager'
  | 'accountant'
  | 'cashier'
  | 'sales'
  | 'warehouse_keeper'
  | 'orders'
  | 'delivery_driver'
  | 'view_only';

export interface StaffAccountInput {
  fullName: string;
  email?: string;
  phone?: string;
  jobTitle?: string;
  branchId?: string;
  role: Exclude<Role, 'Owner'>;
  password?: string;
}

export interface StaffAuditRecord {
  id: string;
  actorName: string;
  action: string;
  targetUserId: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
}

interface StaffAccountRow {
  user_id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  job_title: string | null;
  branch_id: string | null;
  branch_name: string | null;
  is_active: boolean;
  role_code: string | null;
  role_name_ar: string | null;
  created_at: string;
  updated_at: string;
  last_sign_in_at: string | null;
}

const roleToCode: Record<Exclude<Role, 'Owner'>, StaffRoleCode> = {
  Admin: 'admin',
  Accountant: 'accountant',
  Cashier: 'cashier',
  'Sales Employee': 'sales',
  'Warehouse Employee': 'warehouse_keeper',
  'Orders Employee': 'orders',
  'Delivery Driver': 'delivery_driver',
  'View Only': 'view_only',
};

const codeToRole: Record<string, Role> = {
  owner: 'Owner',
  admin: 'Admin',
  manager: 'Admin',
  accountant: 'Accountant',
  cashier: 'Cashier',
  sales: 'Sales Employee',
  warehouse_keeper: 'Warehouse Employee',
  orders: 'Orders Employee',
  delivery_driver: 'Delivery Driver',
  view_only: 'View Only',
};

const staffActionNames = {
  list: 'list',
  audit: 'audit',
  create: 'create',
  update: 'update',
  setActive: 'set_active',
  setPassword: 'set_password',
} as const;

function assertSupabaseReady() {
  if (!supabase || !isSupabaseConfigured) {
    throw new Error('إعداد Supabase غير مكتمل. لا يمكن إدارة حسابات الموظفين الآن.');
  }
}

function messageFromUnknown(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as {error?: unknown; message?: unknown};
  if (typeof candidate.error === 'string') return candidate.error;
  if (typeof candidate.message === 'string') return candidate.message;
  return null;
}

async function callStaffApi<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  assertSupabaseReady();

  const { data, error } = await supabase!.functions.invoke('manage-staff-users', {
    body: { action, ...payload },
  });
  const payloadError = messageFromUnknown(data);

  if (error || payloadError) {
    throw new Error(payloadError || error?.message || 'تعذر إكمال عملية إدارة الموظفين.');
  }

  return data as T;
}

function mapStaffAccount(row: StaffAccountRow): User {
  const role = codeToRole[row.role_code || 'view_only'] || 'View Only';
  return {
    id: row.user_id,
    name: row.full_name || 'موظف بدون اسم',
    email: row.email || '',
    phone: row.phone || '',
    role,
    branchId: row.branch_id || '',
    jobTitle: row.job_title || undefined,
    permissions: ROLE_PERMISSIONS_MAP[role],
    isActive: Boolean(row.is_active),
    lastLogin: row.last_sign_in_at || undefined,
  };
}

export function getStaffRoleCode(role: Exclude<Role, 'Owner'>): StaffRoleCode {
  return roleToCode[role];
}

export function getAssignableRoles(): Exclude<Role, 'Owner'>[] {
  return [
    'Admin',
    'Accountant',
    'Cashier',
    'Sales Employee',
    'Warehouse Employee',
    'Orders Employee',
    'Delivery Driver',
    'View Only',
  ];
}

export async function fetchStaffAccounts(): Promise<User[]> {
  const response = await callStaffApi<{ data: StaffAccountRow[] }>(staffActionNames.list);
  return (response.data || []).map(mapStaffAccount);
}

export async function createStaffAccount(input: StaffAccountInput): Promise<void> {
  await callStaffApi(staffActionNames.create, {
    fullName: input.fullName,
    email: input.email,
    phone: input.phone || null,
    jobTitle: input.jobTitle || null,
    branchId: input.branchId || null,
    roleCode: getStaffRoleCode(input.role),
    password: input.password,
  });
}

export async function updateStaffAccount(userId: string, input: StaffAccountInput): Promise<void> {
  await callStaffApi(staffActionNames.update, {
    userId,
    fullName: input.fullName,
    phone: input.phone || null,
    jobTitle: input.jobTitle || null,
    branchId: input.branchId || null,
    roleCode: getStaffRoleCode(input.role),
  });
}

export async function setStaffAccountActive(userId: string, isActive: boolean): Promise<void> {
  await callStaffApi(staffActionNames.setActive, { userId, isActive });
}

export async function setStaffAccountPassword(userId: string, password: string): Promise<void> {
  await callStaffApi(staffActionNames.setPassword, { userId, password });
}

export async function fetchStaffAuditRecords(): Promise<StaffAuditRecord[]> {
  const response = await callStaffApi<{
    data: Array<{
      id: string;
      actor_name: string | null;
      action: string;
      entity_id: string | null;
      details: Record<string, unknown> | null;
      created_at: string;
    }>;
  }>(staffActionNames.audit);

  return (response.data || []).map((record) => ({
    id: record.id,
    actorName: record.actor_name || 'النظام',
    action: record.action,
    targetUserId: record.entity_id,
    details: record.details,
    createdAt: record.created_at,
  }));
}

export function branchNameForStaffAccount(user: User, branches: Branch[]): string {
  return branches.find((branch) => branch.id === user.branchId)?.name || 'غير محدد';
}
