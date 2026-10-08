import { createFileRoute } from "@tanstack/react-router";
import { operatorHead } from "@/lib/hostinger-core/operator-head";
import { CommandCenter } from "@/components/command-center";
export const Route = createFileRoute("/_app/")({ head: () => operatorHead("מרכז שליטה", "מצב אנשים, שיחות, טיפול מנהל ומשימות בזוגה."), component: CommandCenter });
