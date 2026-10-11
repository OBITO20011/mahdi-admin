import React from 'react';
import {PageHeader, DetailPanel} from '../../src/components/ui/Surface';

// This valid source is also compiled by the ordinary repository typecheck.
// The contract test removes the required prop in memory, never suppressing errors.
export const requiredPropsControl = <PageHeader title="اختبار خصائص مطلوبة" />;
export const refControl = <DetailPanel ref={React.createRef<HTMLElement>()}>تفاصيل</DetailPanel>;
