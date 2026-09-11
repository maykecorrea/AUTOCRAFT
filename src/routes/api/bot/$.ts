import { createFileRoute } from "@tanstack/react-router";
import { handleBotFetch } from "@/lib/bot/http";

export const Route = createFileRoute("/api/bot/$")({
  server: {
    handlers: {
      GET: ({ request }) => handleBotFetch(request),
      POST: ({ request }) => handleBotFetch(request),
    },
  },
});
