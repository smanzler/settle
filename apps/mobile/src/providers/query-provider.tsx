import { queryClient } from "@/lib/query-client";
import { trpcClient, TRPCProvider } from "@/lib/trpc";
import { QueryClientProvider } from "@tanstack/react-query";

export function QueryProvider(props: { children: React.ReactNode }) {
  return (
    <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {props.children}
      </QueryClientProvider>
    </TRPCProvider>
  );
}
