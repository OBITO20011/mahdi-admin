/**
 * Nawasrah Business Manager - User Form Modal (Add/Edit User & Role Assignment)
 */

import React, { useState } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { User, Role } from '../../types';
import { Check, Shield, User as UserIcon, Lock, Mail, Phone, Building } from 'lucide-react';
import { ROLE_PERMISSIONS_MAP } from '../../constants';

interface UserFormModalProps {
  initialUser?: User;
  onClose: () => void;
}

export const UserFormModal: React.FC<UserFormModalProps> = ({ initialUser, onClose }) => {
  const { createUser, updateUser, branches } = useAppStore();

  const isEditing = Boolean(initialUser?.id);

  const [name, setName] = useState(initialUser?.name || '');
  const [email, setEmail] = useState(initialUser?.email || '');
  const [phone, setPhone] = useState(initialUser?.phone || '');
  const [jobTitle, setJobTitle] = useState(initialUser?.jobTitle || '');
  const [role, setRole] = useState<Role>(initialUser?.role || 'Cashier');
  const [branchId, setBranchId] = useState(initialUser?.branchId || branches[0]?.id || 'b-amman-main');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    if (isEditing && initialUser?.id) {
      updateUser(initialUser.id, { name, email, phone, jobTitle, role, branchId });
    } else {
      createUser({ name, email, phone, jobTitle, role, branchId });
    }
    onClose();
  };

  const currentRolePermissions = ROLE_PERMISSIONS_MAP[role] || [];

  return (
    <form onSubmit={handleSubmit} className="space-y-3 text-xs">
      <div className="space-y-1">
        <label className="text-[11px] font-bold text-slate-300 block">اسم الموظف الكامل *</label>
        <input
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="أدخل الاسم الرباعي..."
          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-[11px] font-bold text-slate-300 block">رقم الهاتف *</label>
          <input
            type="tel"
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="079XXXXXXX"
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="space-y-1">
          <label className="text-[11px] font-bold text-slate-300 block">البريد الإلكتروني</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="employee@nawasrah.jo"
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-[11px] font-bold text-slate-300 block">المسمى الوظيفي</label>
          <input
            type="text"
            value={jobTitle}
            onChange={(e) => setJobTitle(e.target.value)}
            placeholder="محاسب رئيسي، كاشير، أمين مستودع..."
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="space-y-1">
          <label className="text-[11px] font-bold text-slate-300 block">الفرع التابع له</label>
          <select
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-slate-100 focus:outline-none"
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Role Selection */}
      <div className="space-y-1">
        <label className="text-[11px] font-bold text-slate-300 block">الدور والجهود (Role) *</label>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-blue-400 font-bold focus:outline-none"
        >
          <option value="Owner">Owner - المالك (صلاحيات مطلقة)</option>
          <option value="Admin">Admin - المدير التنفيذي</option>
          <option value="Accountant">Accountant - محاسب</option>
          <option value="Cashier">Cashier - كاشير مبيعات</option>
          <option value="Sales Employee">Sales Employee - موظف مبيعات</option>
          <option value="Warehouse Employee">Warehouse Employee - مسؤول المستودع والمخزون</option>
          <option value="Orders Employee">Orders Employee - متابع الطلبات أونلاين</option>
          <option value="Delivery Driver">Delivery Driver - سائق التوصيل</option>
          <option value="View Only">View Only - مشاهدة فقط</option>
        </select>
      </div>

      {/* Assigned Permissions Preview */}
      <div className="bg-slate-950 p-3 rounded-2xl border border-slate-800 space-y-1">
        <span className="text-[10px] text-slate-400 font-bold block">
          الصلاحيات التلقائية الممنوحة بهذا الدور ({currentRolePermissions.length}):
        </span>
        <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto pt-1">
          {currentRolePermissions.map((perm) => (
            <span key={perm} className="bg-blue-600/20 text-blue-300 px-2 py-0.5 rounded-full text-[9px] font-mono border border-blue-500/30">
              {perm}
            </span>
          ))}
        </div>
      </div>

      <div className="flex gap-2 pt-2">
        <button
          type="submit"
          className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-bold py-2.5 rounded-xl text-xs transition flex items-center justify-center gap-1"
        >
          <Check className="w-4 h-4" />
          <span>{isEditing ? 'حفظ تعديلات المستخدم' : 'إضافة المستخدم للنظام'}</span>
        </button>

        <button
          type="button"
          onClick={onClose}
          className="px-4 bg-slate-800 text-slate-300 font-bold py-2.5 rounded-xl text-xs transition"
        >
          إلغاء
        </button>
      </div>
    </form>
  );
};
