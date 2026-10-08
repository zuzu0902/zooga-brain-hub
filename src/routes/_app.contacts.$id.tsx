import { createFileRoute } from "@tanstack/react-router";
import { operatorHead } from "@/lib/hostinger-core/operator-head";
import { OperatorContact } from "@/components/operator-contact";
export const Route = createFileRoute("/_app/contacts/$id")({
  head: () => operatorHead("פרטי איש קשר", "פרטי קשר, שיחות אחרונות ומשימות לאיש קשר בזוגה."),
  component: ContactProfile,
});
function ContactProfile() { const { id } = Route.useParams(); return <OperatorContact id={id} />; }
