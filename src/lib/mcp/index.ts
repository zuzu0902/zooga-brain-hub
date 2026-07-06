import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listContactsTool from "./tools/list-contacts";
import getContactTool from "./tools/get-contact";
import listTasksTool from "./tools/list-tasks";
import createTaskTool from "./tools/create-task";
import listOffersTool from "./tools/list-offers";

// The issuer must be the direct Supabase host (never the .lovable.cloud proxy).
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "zooga-crm-mcp",
  title: "Zooga CRM",
  version: "0.1.0",
  instructions:
    "Tools for the Zooga CRM. Read contacts, offers, and tasks, or create new tasks. All calls are scoped to the signed-in user's data.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listContactsTool, getContactTool, listOffersTool, listTasksTool, createTaskTool],
});