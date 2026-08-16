import {
  Banknote,
  Building2,
  Car,
  Clapperboard,
  CreditCard,
  Hammer,
  House,
  Landmark,
  Plane,
  Receipt,
  ShoppingBag,
  Sparkles,
  Stethoscope,
  UtensilsCrossed,
  Wallet,
  Wrench,
  type LucideIcon,
} from "lucide-react-native";

/** Plaid personal-finance-category (primary) → icon, for rows with no logo. */
const ICONS: Record<string, LucideIcon> = {
  INCOME: Banknote,
  TRANSFER_IN: Wallet,
  TRANSFER_OUT: Wallet,
  LOAN_PAYMENTS: Landmark,
  BANK_FEES: Receipt,
  ENTERTAINMENT: Clapperboard,
  FOOD_AND_DRINK: UtensilsCrossed,
  GENERAL_MERCHANDISE: ShoppingBag,
  HOME_IMPROVEMENT: Hammer,
  MEDICAL: Stethoscope,
  PERSONAL_CARE: Sparkles,
  GENERAL_SERVICES: Wrench,
  GOVERNMENT_AND_NON_PROFIT: Building2,
  TRANSPORTATION: Car,
  TRAVEL: Plane,
  RENT_AND_UTILITIES: House,
};

export const categoryIcon = (category?: string | null): LucideIcon =>
  (category && ICONS[category]) || CreditCard;
