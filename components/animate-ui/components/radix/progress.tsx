import * as React from 'react';

import {
  Progress as ProgressPrimitive,
  ProgressIndicator as ProgressIndicatorPrimitive,
  type ProgressProps as ProgressPrimitiveProps,
} from '@/components/animate-ui/primitives/radix/progress';
import { cn } from '@/lib/utils';

type ProgressProps = ProgressPrimitiveProps;

function Progress({ className, children, ...props }: ProgressProps) {
  return (
    <ProgressPrimitive
      className={cn(
        'bg-primary/20 relative h-2 w-full overflow-hidden rounded-full',
        className,
      )}
      {...props}
    >
      {children ?? (
        <ProgressIndicatorPrimitive className="bg-primary rounded-full h-full w-full flex-1" />
      )}
    </ProgressPrimitive>
  );
}

type ProgressIndicatorProps = React.ComponentProps<
  typeof ProgressIndicatorPrimitive
>;

function ProgressIndicator({ className, ...props }: ProgressIndicatorProps) {
  return (
    <ProgressIndicatorPrimitive
      className={cn('bg-primary rounded-full h-full w-full flex-1', className)}
      {...props}
    />
  );
}

export { Progress, ProgressIndicator, type ProgressProps, type ProgressIndicatorProps };
