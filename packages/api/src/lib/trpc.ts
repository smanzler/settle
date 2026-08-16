import { type CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";
import { initTRPC, TRPCError } from "@trpc/server";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "./auth";
import { ensureHousehold, type Member } from "./household";

export const createContext = async ({
  req,
  res,
}: CreateFastifyContextOptions) => {
  const { session, user } =
    (await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    })) ?? {};

  let member: Promise<Member> | undefined;

  return {
    req,
    res,
    user,
    session,
    /**
     * The seat this request acts as, resolved at most once.
     *
     * The mobile client speaks over `httpBatchLink`, so several household
     * procedures share one context per HTTP request. Memoizing here is the
     * difference between one `household_members` lookup per request and one per
     * procedure in it.
     */
    resolveMember: (forUser: Parameters<typeof ensureHousehold>[0]) =>
      (member ??= ensureHousehold(forUser)),
  };
};

export type Context = Awaited<ReturnType<typeof createContext>>;

const t = initTRPC.context<Context>().create();

export const router = t.router;

export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use((opts) => {
  const { ctx } = opts;

  if (!ctx.user || !ctx.session) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  return opts.next({ ctx: { user: ctx.user, session: ctx.session } });
});

/**
 * The scope every household-aware procedure runs in.
 *
 * `householdId` is resolved from the session and is **never** accepted as an
 * input anywhere in the API. That single rule eliminates the whole class of
 * cross-household reads: there is no parameter to tamper with. Procedures still
 * AND `household_id = ctx.householdId` into their statements — see the layered
 * defence in the design — but this is the layer that makes the others belt and
 * braces rather than load-bearing.
 */
export const householdProcedure = protectedProcedure.use(async (opts) => {
  const member = await opts.ctx.resolveMember(opts.ctx.user);

  return opts.next({
    ctx: {
      ...opts.ctx,
      member,
      householdId: member.householdId,
    },
  });
});

/**
 * Owner-only, declared in the signature rather than asserted in the body.
 *
 * A procedure added to an owner-gated router is otherwise open to every member
 * unless its author remembers the check its siblings make — the gate belongs
 * where the reader already looks to see what a procedure requires.
 *
 * Row-level rules stay row-level: "the author *or* an owner may void this"
 * is a WHERE clause on the write, not a gate on the procedure.
 */
export const ownerProcedure = householdProcedure.use((opts) => {
  if (opts.ctx.member.role !== "owner") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only the household owner can do that",
    });
  }

  return opts.next();
});
