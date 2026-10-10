import React from 'react';

/** Presentation scope only: native field values, events and form semantics stay intact. */
export const FormFields = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({className='', ...rest}, ref) => <div {...rest} ref={ref} className={`nw-form-fields ${className}`} />,
);
FormFields.displayName = 'FormFields';
