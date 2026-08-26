import { type CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";
import { initTRPC, TRPCError } from "@trpc/server";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "./auth";
import { ensureGroup, type Member } from "./group";

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
     * The mobile client speaks over `httpBatchLink`, so several group procedures
     * share one context per HTTP request. Memoizing here is the difference
     * between one `group_members` lookup per request and one per procedure in it.
     */
    resolveMember: (forUser: Parameters<typeof ensureGroup>[0]) =>
      (member ??= ensureGroup(forUser)),
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
 * The scope every group-aware procedure runs in.
 *
 * `groupId` is resolved from the session and is **never** accepted as an input
 * anywhere in the API. That single rule eliminates the whole class of
 * cross-group reads: there is no parameter to tamper with. Procedures still AND
 * `group_id = ctx.groupId` into their statements, and the composite foreign keys
 * refuse a member from another group outright — but this is the layer that makes
 * the others belt and braces rather than load-bearing.
 */
export const groupProcedure = protectedProcedure.use(async (opts) => {
  const member = await opts.ctx.resolveMember(opts.ctx.user);

  return opts.next({
    ctx: { ...opts.ctx, member, groupId: member.groupId },
  });
});

/**
 * Owner-only, declared in the signature rather than asserted in the body.
 *
 * A procedure added to an owner-gated router is otherwise open to every member
 * unless its author remembers the check its siblings make — the gate belongs
 * where the reader already looks to see what a procedure requires.
 *
 * Row-level rules stay row-level: "the author *or* an owner may void this" is a
 * WHERE clause on the write, not a gate on the procedure.
 */
export const ownerProcedure = groupProcedure.use((opts) => {
  if (opts.ctx.member.role !== "owner") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only the group owner can do that",
    });
  }

  return opts.next();
});
