import { createFileRoute, Outlet } from "@tanstack/react-router";
export const Route = createFileRoute("/_app/settings")({ component: SettingsLayout });
function SettingsLayout() { return <Outlet />; }