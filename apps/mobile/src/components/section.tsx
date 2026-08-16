import { Icon } from "@/components/ui/icon";
import { Pressable } from "@/components/ui/pressable";
import { Text, TextClassContext } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import { ChevronRight } from "lucide-react-native";
import React from "react";
import { View, type ViewProps } from "react-native";

/** Which edges of the card a row draws. See SectionItem. */
type SectionItemEdges = { isFirst?: boolean; isLast?: boolean };

function Section({
  className,
  ...props
}: ViewProps & React.RefAttributes<View>) {
  return (
    <TextClassContext.Provider value="text-card-foreground">
      <View className={cn("gap-2", className)} {...props} />
    </TextClassContext.Provider>
  );
}

function SectionHeader({
  className,
  ...props
}: ViewProps & React.RefAttributes<View>) {
  return <View className={cn("flex flex-col gap-1.5", className)} {...props} />;
}

function SectionTitle({
  className,
  ...props
}: React.ComponentProps<typeof Text> & React.RefAttributes<Text>) {
  return (
    <Text
      role="heading"
      aria-level={3}
      className={cn("font-semibold leading-none", className)}
      {...props}
    />
  );
}

function SectionDescription({
  className,
  ...props
}: React.ComponentProps<typeof Text> & React.RefAttributes<Text>) {
  return (
    <Text
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  );
}

const isSectionItem = (
  child: React.ReactNode,
): child is React.ReactElement<SectionItemEdges> =>
  React.isValidElement(child) && child.type === SectionItem;

function SectionContent({
  className,
  children,
  ...props
}: ViewProps & React.RefAttributes<View>) {
  const count = React.Children.count(children);
  return (
    // No `border` here — each item draws its own edges so that a row is
    // self-sufficient and works in a virtualized list too. See SectionItem.
    <View
      className={cn(
        "bg-card flex flex-col rounded-xl shadow-sm shadow-black/5 overflow-hidden",
        className,
      )}
      {...props}
    >
      {React.Children.map(children, (child, index) =>
        isSectionItem(child)
          ? React.cloneElement(child, {
              isFirst: index === 0,
              isLast: index === count - 1,
            })
          : child,
      )}
    </View>
  );
}

/**
 * A row in a card.
 *
 * The edge geometry lives here rather than on a wrapping container so the row
 * is self-contained: `SectionContent` derives `isFirst`/`isLast` by mapping over
 * its children, but a virtualized list (which never has all rows at once) can
 * pass the same flags per item and get an identical card.
 */
const sectionItemVariants = cva(
  "bg-card border-border flex-row gap-3 px-3 items-center border-x",
  {
    variants: {
      size: {
        /** One line of text, fixed height. */
        default: "h-11",
        /** Two lines, tight — a row whose subtitle is a chip or a balance. */
        snug: "h-auto py-2",
        /** Two lines — a row with a title and a caption under it. */
        tall: "h-auto py-2.5",
      },
    },
    defaultVariants: { size: "default" },
  },
);

function SectionItem({
  className,
  isFirst,
  isLast,
  onPress,
  size,
  ...viewProps
}: ViewProps &
  React.RefAttributes<View> &
  SectionItemEdges &
  VariantProps<typeof sectionItemVariants> & { onPress?: () => void }) {
  const content = (
    <View
      className={cn(
        sectionItemVariants({ size }),
        isFirst === true && "rounded-t-xl border-t",
        // The last row closes the card; every other row's bottom edge is the
        // separator between it and the next one.
        isLast === true ? "rounded-b-xl border-b" : "border-b",
        className,
      )}
      {...viewProps}
    />
  );

  if (onPress != null) {
    return (
      <Pressable onPress={onPress} className="active:opacity-70">
        {content}
      </Pressable>
    );
  }

  return content;
}

function SectionItemTitle({
  className,
  ...props
}: React.ComponentProps<typeof Text> & React.RefAttributes<Text>) {
  return (
    <Text
      role="heading"
      aria-level={3}
      className={cn("font-semibold", className)}
      {...props}
    />
  );
}

function SectionItemContent({
  className,
  textClassName,
  children,
  ...props
}: ViewProps & React.RefAttributes<View> & { textClassName?: string }) {
  if (children === undefined) {
    return (
      <View className={cn("ml-auto", className)}>
        <Icon as={ChevronRight} />
      </View>
    );
  }

  if (typeof children === "string") {
    return (
      <View
        className={cn("ml-auto flex-row gap-1 items-center", className)}
        {...props}
      >
        <Text className={cn("text-muted-foreground", textClassName)}>
          {children}
        </Text>
        <Icon as={ChevronRight} />
      </View>
    );
  }

  return (
    <View className={cn("ml-auto", className)} {...props}>
      {children}
    </View>
  );
}

export {
  Section,
  SectionContent,
  SectionDescription,
  SectionHeader,
  SectionItem,
  SectionItemContent,
  SectionItemTitle,
  SectionTitle,
};
