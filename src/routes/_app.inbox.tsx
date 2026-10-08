import { createFileRoute } from "@tanstack/react-router";
import { operatorHead } from "@/lib/hostinger-core/operator-head";
import { OperatorQueuePage } from "@/components/operator-data";
export const Route = createFileRoute("/_app/inbox")({ head: () => operatorHead("שיחות", "השיחות האחרונות ומצב הטיפול בהן בזוגה."), component: QueuePage });

function QueuePage() { return <OperatorQueuePage kind="conversations" />; }
