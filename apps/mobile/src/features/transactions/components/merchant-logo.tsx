import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Icon } from "@/components/ui/icon";
import { categoryIcon } from "../lib/category-icons";

/**
 * `Avatar` already wraps `expo-image` with `cachePolicy="memory-disk"` and
 * swaps to the fallback when a logo 404s, which merchant logos regularly do.
 */
export function MerchantLogo({
  logoUrl,
  category,
}: {
  logoUrl: string | null;
  category: string | null;
}) {
  return (
    <Avatar alt="" className="size-10">
      {logoUrl ? <AvatarImage source={{ uri: logoUrl }} /> : null}
      <AvatarFallback>
        <Icon
          as={categoryIcon(category)}
          className="text-muted-foreground size-5"
        />
      </AvatarFallback>
    </Avatar>
  );
}
