import db from "../../../db/index";
import { PushTokens } from "../../../db/schema";
import { protectedProcedure, router } from "../../../lib/trpc";
import { z } from "zod";

export const pushTokensRouter = router({
  register: protectedProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async (opts) => {
      const { user } = opts.ctx;
      const { token } = opts.input;

      await db
        .insert(PushTokens)
        .values({ token, userId: user.id })
        .onConflictDoUpdate({
          target: PushTokens.token,
          set: { userId: user.id },
        });

      return { token };
    }),
});
