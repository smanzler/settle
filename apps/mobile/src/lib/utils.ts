import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

const LOCALE = "en-US";

// Module level, not a hook: React Compiler forbids mutable state in a component
// body, and Intl.NumberFormat construction is the expensive part.
const currencyFormatters = new Map<string, Intl.NumberFormat>();

/**
 * `currency` is nullable throughout the Plaid data, and unofficial codes make
 * `Intl` throw, so both fall back to a plain decimal rather than crashing a row.
 */
const buildCurrencyFormatter = (currency?: string | null) => {
  try {
    return new Intl.NumberFormat(LOCALE, {
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
      style: currency ? "currency" : "decimal",
      ...(currency ? { currency } : {}),
    });
  } catch {
    return new Intl.NumberFormat(LOCALE, {
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    });
  }
};

const formatCurrency = (value: number, currency?: string | null) => {
  if (!Number.isFinite(value)) return "—";

  const key = currency ?? "";
  const cached = currencyFormatters.get(key);
  if (cached) return cached.format(value);

  const formatter = buildCurrencyFormatter(currency);
  currencyFormatters.set(key, formatter);

  return formatter.format(value);
};

export { formatCurrency };
