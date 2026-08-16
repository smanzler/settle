import { auth } from "../../lib/auth";
import { fromNodeHeaders } from "better-auth/node";
import { type FastifyPluginCallback } from "fastify";

export const authRoutes: FastifyPluginCallback = async (fastify, _) => {
  fastify.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    async handler(request, reply) {
      try {
        // better-auth's handler speaks the Fetch API and Fastify does not, so
        // the request is re-materialised before it is handed over.
        const url = new URL(request.url, `http://${request.headers.host}`);

        const headers = fromNodeHeaders(request.headers);

        const req = new Request(url.toString(), {
          method: request.method,
          headers,
          ...(request.body ? { body: JSON.stringify(request.body) } : {}),
        });

        const response = await auth.handler(req);

        reply.status(response.status);
        response.headers.forEach((value, key) => reply.header(key, value));
        return reply.send(response.body ? await response.text() : null);
      } catch (error) {
        console.error("Authentication Error:", error);
        return reply.status(500).send({
          error: "Internal authentication error",
          code: "AUTH_FAILURE",
        });
      }
    },
  });
};
