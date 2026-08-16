import { createTRPCContext } from "@trpc/tanstack-react-query";
import { type AppRouter } from "@budget/api";
import { type inferRouterOutputs } from "@trpc/server";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { authClient } from "@/lib/auth-client";
import { env } from "@/env";

export const { TRPCProvider, useTRPC, useTRPCClient } =
  createTRPCContext<AppRouter>();

const createLinks = () => [
  httpBatchLink({
    url: env.EXPO_PUBLIC_API_URL + "/trpc",
    headers() {
      const cookies = authClient.getCookie();
      return cookies ? { Cookie: cookies } : {};
    },
  }),
];

export const trpcClient = createTRPCClient<AppRouter>({ links: createLinks() });

/**
 * The API's return types, for typing props without re-declaring shapes.
 *
 * Note there is no transformer on the link, so anything the API returns as a
 * `Date` arrives as a string while this type still claims `Date`. API
 * procedures type timestamps as `string` at the boundary to keep this honest.
 */
export type RouterOutputs = inferRouterOutputs<AppRouter>;
