import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { Dashboard } from "@/components/bot/Dashboard";

const loadLiveStatus = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { existsSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const p = join(process.cwd(), "data", "last-status.json");
    if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    /* empty */
  }
  return null;
});

export const Route = createFileRoute("/")({
  loader: () => loadLiveStatus(),
  component: Home,
});

function Home() {
  const initial = Route.useLoaderData();
  return <Dashboard initial={initial} />;
}