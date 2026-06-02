import { defineApp } from "convex/server";
import actionCache from "@convex-dev/action-cache/convex.config";
import migrations from "@convex-dev/migrations/convex.config";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";
import pushNotifications from "@convex-dev/expo-push-notifications/convex.config";
import workflow from "@convex-dev/workflow/convex.config";
import agent from "@convex-dev/agent/convex.config";
import rag from "@convex-dev/rag/convex.config";
import crons from "@convex-dev/crons/convex.config";
import shardedCounter from "@convex-dev/sharded-counter/convex.config";
import aggregate from "@convex-dev/aggregate/convex.config";

const app = defineApp();
app.use(actionCache);
app.use(migrations);
app.use(rateLimiter);
app.use(pushNotifications);
app.use(workflow);
app.use(agent);
app.use(rag);
app.use(crons);
app.use(shardedCounter);
app.use(aggregate);

export default app;
