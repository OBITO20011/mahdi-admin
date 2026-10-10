import React from 'react';

/** Presentation scope only: native field values, events and form semantics stay intact. */
export const FormFields: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({className='', ...rest}) => (
  <div {...rest} className={`nw-form-fields ${className}`} />
);
