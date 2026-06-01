import { cn } from "@/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset transition-colors",
  {
    variants: {
      variant: {
        default: "bg-primary/10 text-primary ring-primary/30",
        secondary: "bg-secondary text-secondary-foreground ring-border",
        destructive: "bg-destructive/10 text-destructive ring-destructive/30",
        outline: "text-foreground ring-border",
        profit: "bg-profit/10 text-profit ring-profit/30",
        loss: "bg-loss/10 text-loss ring-loss/30",
        warning: "bg-warning/10 text-warning ring-warning/30",
        info: "bg-info/10 text-info ring-info/30",
        muted: "bg-muted text-muted-foreground ring-border",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
