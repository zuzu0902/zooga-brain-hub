import { createFileRoute } from "@tanstack/react-router";
import { operatorHead } from "@/lib/hostinger-core/operator-head";
import { OperatorQueuePage } from "@/components/operator-data";
export const Route = createFileRoute("/_app/handoff")({ head: () => operatorHead("טיפול מנהל", "פניות פתוחות הדורשות טיפול מנהל בזוגה."), component: QueuePage });

function QueuePage() { return <OperatorQueuePage kind="handoffs" />; }
