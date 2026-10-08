import { createFileRoute } from "@tanstack/react-router";
import { operatorHead } from "@/lib/hostinger-core/operator-head";
import { OperatorQueuePage } from "@/components/operator-data";
export const Route = createFileRoute("/_app/tasks")({ head: () => operatorHead("משימות", "משימות פתוחות ועדיפות הטיפול בזוגה."), component: QueuePage });

function QueuePage() { return <OperatorQueuePage kind="tasks" />; }
