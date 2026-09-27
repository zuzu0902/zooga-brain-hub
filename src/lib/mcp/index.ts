import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listContactsTool from "./tools/list-contacts";
import getContactTool from "./tools/get-contact";
import listTasksTool from "./tools/list-tasks";
import createTaskTool from "./tools/create-task";
import listOffersTool from "./tools/list-offers";
import recentMessagesTool from "./tools/recent-messages";
import contactConversationTool from "./tools/contact-conversation";
import contactIntakeTool from "./tools/contact-intake";

// The issuer must be the direct Supabase host (never the .lovable.cloud proxy).
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "zooga-os",
  title: "Zooga OS",
  version: "0.2.0",
  instructions:
    "Tools for Zooga OS CRM. Read contacts, Tamar's WhatsApp conversations (list_recent_messages, get_contact_conversation), intake answers (get_contact_intake), offers and tasks; create_task is the only write. Access follows the signed-in user's permissions (administrators).",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [
    listContactsTool,
    getContactTool,
    recentMessagesTool,
    contactConversationTool,
    contactIntakeTool,
    listOffersTool,
    listTasksTool,
    createTaskTool,
  ],
});