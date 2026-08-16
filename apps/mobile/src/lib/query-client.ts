import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 300_000,
      retry: 2,
      // Without a staleTime every mount refetches *every* loaded page of an
      // infinite query, which for the transaction list is brutal.
      staleTime: 30_000,
    },
  },
});
