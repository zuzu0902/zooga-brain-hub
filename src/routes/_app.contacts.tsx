import { createFileRoute, Outlet } from "@tanstack/react-router";
export const Route = createFileRoute("/_app/contacts")({ component: ContactsLayout });
function ContactsLayout() { return <Outlet />; }
