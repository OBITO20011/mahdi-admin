import type {ReactNode} from 'react';
import {describeRejection} from '../../utils/rejectionMessage';

export function RejectionNotice({reason,role='alert',children}:{reason:unknown;role?:'alert'|'status';children?:ReactNode}) {
  const {message,code}=describeRejection(reason);
  return <div role={role} className="space-y-2 text-sm text-nw-warn">
    <p>{message}</p>
    {code&&<details className="text-xs text-nw-muted"><summary className="min-h-11 cursor-pointer">مرجع سبب الرفض</summary>
      <code className="break-all select-all" dir="ltr">{code}</code>
    </details>}
    {children}
  </div>;
}
