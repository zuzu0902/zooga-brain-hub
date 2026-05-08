export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      api_settings: {
        Row: {
          default_source: Database["public"]["Enums"]["contact_source"]
          facebook_page_id: string | null
          id: number
          tamar_backend_api_token: string | null
          tamar_backend_url: string | null
          updated_at: string
          webhook_token: string | null
        }
        Insert: {
          default_source?: Database["public"]["Enums"]["contact_source"]
          facebook_page_id?: string | null
          id?: number
          tamar_backend_api_token?: string | null
          tamar_backend_url?: string | null
          updated_at?: string
          webhook_token?: string | null
        }
        Update: {
          default_source?: Database["public"]["Enums"]["contact_source"]
          facebook_page_id?: string | null
          id?: number
          tamar_backend_api_token?: string | null
          tamar_backend_url?: string | null
          updated_at?: string
          webhook_token?: string | null
        }
        Relationships: []
      }
      contacts: {
        Row: {
          activity_score: number
          age: number | null
          age_range: string | null
          ai_confidence_score: number | null
          ai_offer_fit: string | null
          ai_profile_notes: string | null
          ai_recommended_next_action: string | null
          ai_risk_flags: string | null
          ai_summary: string | null
          availability_preferences: string[]
          birth_date: string | null
          birthday_day: number | null
          birthday_month: number | null
          birthday_year: number | null
          budget_sensitivity: string | null
          campaigns_received: string[]
          city: string | null
          communication_style: string | null
          community_fit_score: number | null
          consent_date: string | null
          consent_marketing: boolean
          created_at: string
          decision_triggers: string[]
          dynamic_profile_fields: Json
          economic_score: number
          email: string | null
          emotional_needs: string[]
          emotional_profile: string | null
          engagement_score: number
          events_interested: string[]
          events_joined: string[]
          facebook_id: string | null
          favorite_activity_types: string[]
          first_name: string | null
          full_name: string | null
          gender: Database["public"]["Enums"]["gender"] | null
          hobbies: string[]
          id: string
          income_range: Database["public"]["Enums"]["income_range"] | null
          intake_status: string | null
          interaction_count: number
          interests: string[]
          last_campaign: string | null
          last_clicked_offer: string | null
          last_interaction_at: string | null
          last_name: string | null
          lifestyle_tags: string[]
          likely_needs: string[]
          loneliness_signal: string | null
          manager_attention_required: boolean
          next_best_offer: string | null
          notes: string | null
          objections: string[]
          offers_sent: string[]
          openness_score: number | null
          personality_tags: string[]
          phone: string | null
          preferred_events: string[]
          preferred_language_style: string | null
          preferred_social_style: string | null
          preferred_trip_style: string | null
          price_sensitivity:
            | Database["public"]["Enums"]["price_sensitivity"]
            | null
          purchase_intent: string | null
          raw_payloads: Json
          recommended_campaign: string | null
          region: string | null
          relationship_goals: string[]
          relationship_readiness: string | null
          relationship_status: string | null
          sales_profile: string | null
          sales_temperature: string | null
          social_goals: string[]
          social_profile: string | null
          source: Database["public"]["Enums"]["contact_source"] | null
          spending_profile:
            | Database["public"]["Enums"]["spending_profile"]
            | null
          status: Database["public"]["Enums"]["contact_status"]
          tags: string[]
          total_revenue: number
          travel_preferences: string[]
          trips_interested: string[]
          updated_at: string
          vip_potential: string | null
          whatsapp_number: string | null
        }
        Insert: {
          activity_score?: number
          age?: number | null
          age_range?: string | null
          ai_confidence_score?: number | null
          ai_offer_fit?: string | null
          ai_profile_notes?: string | null
          ai_recommended_next_action?: string | null
          ai_risk_flags?: string | null
          ai_summary?: string | null
          availability_preferences?: string[]
          birth_date?: string | null
          birthday_day?: number | null
          birthday_month?: number | null
          birthday_year?: number | null
          budget_sensitivity?: string | null
          campaigns_received?: string[]
          city?: string | null
          communication_style?: string | null
          community_fit_score?: number | null
          consent_date?: string | null
          consent_marketing?: boolean
          created_at?: string
          decision_triggers?: string[]
          dynamic_profile_fields?: Json
          economic_score?: number
          email?: string | null
          emotional_needs?: string[]
          emotional_profile?: string | null
          engagement_score?: number
          events_interested?: string[]
          events_joined?: string[]
          facebook_id?: string | null
          favorite_activity_types?: string[]
          first_name?: string | null
          full_name?: string | null
          gender?: Database["public"]["Enums"]["gender"] | null
          hobbies?: string[]
          id?: string
          income_range?: Database["public"]["Enums"]["income_range"] | null
          intake_status?: string | null
          interaction_count?: number
          interests?: string[]
          last_campaign?: string | null
          last_clicked_offer?: string | null
          last_interaction_at?: string | null
          last_name?: string | null
          lifestyle_tags?: string[]
          likely_needs?: string[]
          loneliness_signal?: string | null
          manager_attention_required?: boolean
          next_best_offer?: string | null
          notes?: string | null
          objections?: string[]
          offers_sent?: string[]
          openness_score?: number | null
          personality_tags?: string[]
          phone?: string | null
          preferred_events?: string[]
          preferred_language_style?: string | null
          preferred_social_style?: string | null
          preferred_trip_style?: string | null
          price_sensitivity?:
            | Database["public"]["Enums"]["price_sensitivity"]
            | null
          purchase_intent?: string | null
          raw_payloads?: Json
          recommended_campaign?: string | null
          region?: string | null
          relationship_goals?: string[]
          relationship_readiness?: string | null
          relationship_status?: string | null
          sales_profile?: string | null
          sales_temperature?: string | null
          social_goals?: string[]
          social_profile?: string | null
          source?: Database["public"]["Enums"]["contact_source"] | null
          spending_profile?:
            | Database["public"]["Enums"]["spending_profile"]
            | null
          status?: Database["public"]["Enums"]["contact_status"]
          tags?: string[]
          total_revenue?: number
          travel_preferences?: string[]
          trips_interested?: string[]
          updated_at?: string
          vip_potential?: string | null
          whatsapp_number?: string | null
        }
        Update: {
          activity_score?: number
          age?: number | null
          age_range?: string | null
          ai_confidence_score?: number | null
          ai_offer_fit?: string | null
          ai_profile_notes?: string | null
          ai_recommended_next_action?: string | null
          ai_risk_flags?: string | null
          ai_summary?: string | null
          availability_preferences?: string[]
          birth_date?: string | null
          birthday_day?: number | null
          birthday_month?: number | null
          birthday_year?: number | null
          budget_sensitivity?: string | null
          campaigns_received?: string[]
          city?: string | null
          communication_style?: string | null
          community_fit_score?: number | null
          consent_date?: string | null
          consent_marketing?: boolean
          created_at?: string
          decision_triggers?: string[]
          dynamic_profile_fields?: Json
          economic_score?: number
          email?: string | null
          emotional_needs?: string[]
          emotional_profile?: string | null
          engagement_score?: number
          events_interested?: string[]
          events_joined?: string[]
          facebook_id?: string | null
          favorite_activity_types?: string[]
          first_name?: string | null
          full_name?: string | null
          gender?: Database["public"]["Enums"]["gender"] | null
          hobbies?: string[]
          id?: string
          income_range?: Database["public"]["Enums"]["income_range"] | null
          intake_status?: string | null
          interaction_count?: number
          interests?: string[]
          last_campaign?: string | null
          last_clicked_offer?: string | null
          last_interaction_at?: string | null
          last_name?: string | null
          lifestyle_tags?: string[]
          likely_needs?: string[]
          loneliness_signal?: string | null
          manager_attention_required?: boolean
          next_best_offer?: string | null
          notes?: string | null
          objections?: string[]
          offers_sent?: string[]
          openness_score?: number | null
          personality_tags?: string[]
          phone?: string | null
          preferred_events?: string[]
          preferred_language_style?: string | null
          preferred_social_style?: string | null
          preferred_trip_style?: string | null
          price_sensitivity?:
            | Database["public"]["Enums"]["price_sensitivity"]
            | null
          purchase_intent?: string | null
          raw_payloads?: Json
          recommended_campaign?: string | null
          region?: string | null
          relationship_goals?: string[]
          relationship_readiness?: string | null
          relationship_status?: string | null
          sales_profile?: string | null
          sales_temperature?: string | null
          social_goals?: string[]
          social_profile?: string | null
          source?: Database["public"]["Enums"]["contact_source"] | null
          spending_profile?:
            | Database["public"]["Enums"]["spending_profile"]
            | null
          status?: Database["public"]["Enums"]["contact_status"]
          tags?: string[]
          total_revenue?: number
          travel_preferences?: string[]
          trips_interested?: string[]
          updated_at?: string
          vip_potential?: string | null
          whatsapp_number?: string | null
        }
        Relationships: []
      }
      imported_leads: {
        Row: {
          consent_status: Database["public"]["Enums"]["lead_consent_status"]
          contact_id: string | null
          created_at: string
          first_name: string | null
          full_name: string | null
          id: string
          import_status: Database["public"]["Enums"]["imported_lead_status"]
          last_message_at: string | null
          last_name: string | null
          notes: string | null
          phone: string | null
          raw_row_data: Json | null
          source_campaign: string | null
          source_file_name: string | null
          updated_at: string
          whatsapp_template_status: Database["public"]["Enums"]["whatsapp_template_status"]
        }
        Insert: {
          consent_status?: Database["public"]["Enums"]["lead_consent_status"]
          contact_id?: string | null
          created_at?: string
          first_name?: string | null
          full_name?: string | null
          id?: string
          import_status?: Database["public"]["Enums"]["imported_lead_status"]
          last_message_at?: string | null
          last_name?: string | null
          notes?: string | null
          phone?: string | null
          raw_row_data?: Json | null
          source_campaign?: string | null
          source_file_name?: string | null
          updated_at?: string
          whatsapp_template_status?: Database["public"]["Enums"]["whatsapp_template_status"]
        }
        Update: {
          consent_status?: Database["public"]["Enums"]["lead_consent_status"]
          contact_id?: string | null
          created_at?: string
          first_name?: string | null
          full_name?: string | null
          id?: string
          import_status?: Database["public"]["Enums"]["imported_lead_status"]
          last_message_at?: string | null
          last_name?: string | null
          notes?: string | null
          phone?: string | null
          raw_row_data?: Json | null
          source_campaign?: string | null
          source_file_name?: string | null
          updated_at?: string
          whatsapp_template_status?: Database["public"]["Enums"]["whatsapp_template_status"]
        }
        Relationships: []
      }
      intake_campaigns: {
        Row: {
          campaign_name: string
          created_at: string
          id: string
          sent_count: number
          status: string
          tamar_response: Json | null
          template_name: string
        }
        Insert: {
          campaign_name: string
          created_at?: string
          id?: string
          sent_count?: number
          status?: string
          tamar_response?: Json | null
          template_name: string
        }
        Update: {
          campaign_name?: string
          created_at?: string
          id?: string
          sent_count?: number
          status?: string
          tamar_response?: Json | null
          template_name?: string
        }
        Relationships: []
      }
      intake_inbox: {
        Row: {
          created_at: string
          id: string
          matched_contact_id: string | null
          parsed_email: string | null
          parsed_facebook_id: string | null
          parsed_message: string | null
          parsed_name: string | null
          parsed_phone: string | null
          processed_at: string | null
          raw_payload: Json
          source: Database["public"]["Enums"]["contact_source"]
          status: Database["public"]["Enums"]["intake_status"]
        }
        Insert: {
          created_at?: string
          id?: string
          matched_contact_id?: string | null
          parsed_email?: string | null
          parsed_facebook_id?: string | null
          parsed_message?: string | null
          parsed_name?: string | null
          parsed_phone?: string | null
          processed_at?: string | null
          raw_payload: Json
          source?: Database["public"]["Enums"]["contact_source"]
          status?: Database["public"]["Enums"]["intake_status"]
        }
        Update: {
          created_at?: string
          id?: string
          matched_contact_id?: string | null
          parsed_email?: string | null
          parsed_facebook_id?: string | null
          parsed_message?: string | null
          parsed_name?: string | null
          parsed_phone?: string | null
          processed_at?: string | null
          raw_payload?: Json
          source?: Database["public"]["Enums"]["contact_source"]
          status?: Database["public"]["Enums"]["intake_status"]
        }
        Relationships: [
          {
            foreignKeyName: "intake_inbox_matched_contact_id_fkey"
            columns: ["matched_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      interactions: {
        Row: {
          contact_id: string
          content: string | null
          created_at: string
          id: string
          related_event_id: string | null
          related_offer_id: string | null
          source: string | null
          timestamp: string
          type: Database["public"]["Enums"]["interaction_type"]
        }
        Insert: {
          contact_id: string
          content?: string | null
          created_at?: string
          id?: string
          related_event_id?: string | null
          related_offer_id?: string | null
          source?: string | null
          timestamp?: string
          type: Database["public"]["Enums"]["interaction_type"]
        }
        Update: {
          contact_id?: string
          content?: string | null
          created_at?: string
          id?: string
          related_event_id?: string | null
          related_offer_id?: string | null
          source?: string | null
          timestamp?: string
          type?: Database["public"]["Enums"]["interaction_type"]
        }
        Relationships: [
          {
            foreignKeyName: "interactions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          channel: Database["public"]["Enums"]["message_channel"]
          contact_id: string
          created_at: string
          id: string
          message_text: string
          offer_id: string | null
          reply_text: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["message_status"]
        }
        Insert: {
          channel?: Database["public"]["Enums"]["message_channel"]
          contact_id: string
          created_at?: string
          id?: string
          message_text: string
          offer_id?: string | null
          reply_text?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["message_status"]
        }
        Update: {
          channel?: Database["public"]["Enums"]["message_channel"]
          contact_id?: string
          created_at?: string
          id?: string
          message_text?: string
          offer_id?: string | null
          reply_text?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["message_status"]
        }
        Relationships: [
          {
            foreignKeyName: "messages_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "offers"
            referencedColumns: ["id"]
          },
        ]
      }
      offers: {
        Row: {
          category: Database["public"]["Enums"]["offer_category"]
          created_at: string
          description: string | null
          id: string
          offer_url: string | null
          price: number | null
          status: Database["public"]["Enums"]["offer_status"]
          target_interests: string[]
          target_max_age: number | null
          target_min_age: number | null
          target_region: string | null
          target_spending_profile:
            | Database["public"]["Enums"]["spending_profile"]
            | null
          title: string
          updated_at: string
        }
        Insert: {
          category: Database["public"]["Enums"]["offer_category"]
          created_at?: string
          description?: string | null
          id?: string
          offer_url?: string | null
          price?: number | null
          status?: Database["public"]["Enums"]["offer_status"]
          target_interests?: string[]
          target_max_age?: number | null
          target_min_age?: number | null
          target_region?: string | null
          target_spending_profile?:
            | Database["public"]["Enums"]["spending_profile"]
            | null
          title: string
          updated_at?: string
        }
        Update: {
          category?: Database["public"]["Enums"]["offer_category"]
          created_at?: string
          description?: string | null
          id?: string
          offer_url?: string | null
          price?: number | null
          status?: Database["public"]["Enums"]["offer_status"]
          target_interests?: string[]
          target_max_age?: number | null
          target_min_age?: number | null
          target_region?: string | null
          target_spending_profile?:
            | Database["public"]["Enums"]["spending_profile"]
            | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      tasks: {
        Row: {
          assigned_to: string | null
          contact_id: string | null
          created_at: string
          description: string | null
          due_date: string | null
          id: string
          priority: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          contact_id?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          priority?: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          contact_id?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          priority?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      webhook_logs: {
        Row: {
          created_at: string
          error: string | null
          id: string
          payload: Json | null
          source: string
          status: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          payload?: Json | null
          source?: string
          status?: string
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          payload?: Json | null
          source?: string
          status?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "user"
      contact_source:
        | "Facebook"
        | "WhatsApp"
        | "Zooga Website"
        | "Event"
        | "Tamar Bot"
        | "Manual"
        | "Tamar WhatsApp"
      contact_status:
        | "new_lead"
        | "active_member"
        | "interested"
        | "customer"
        | "VIP"
        | "inactive"
      gender: "male" | "female" | "other" | "prefer_not_to_say"
      imported_lead_status:
        | "imported"
        | "duplicate"
        | "ready_for_intake"
        | "sent_to_tamar"
        | "replied"
        | "converted_to_contact"
        | "failed"
        | "opted_out"
      income_range: "low" | "medium" | "high" | "prefer_not_to_say"
      intake_status: "pending" | "approved" | "merged" | "rejected"
      interaction_type:
        | "facebook_message"
        | "whatsapp_message"
        | "link_click"
        | "event_interest"
        | "form_submit"
        | "purchase_interest"
        | "admin_note"
      lead_consent_status: "unknown" | "approved" | "declined"
      message_channel: "Facebook" | "WhatsApp" | "SMS" | "Email"
      message_status: "draft" | "sent" | "failed" | "replied"
      offer_category:
        | "event"
        | "trip"
        | "party"
        | "lecture"
        | "workshop"
        | "digital_product"
        | "membership"
      offer_status: "draft" | "active" | "archived"
      price_sensitivity: "high" | "medium" | "low"
      spending_profile: "budget" | "standard" | "premium" | "luxury"
      whatsapp_template_status:
        | "not_sent"
        | "sent"
        | "delivered"
        | "read"
        | "replied"
        | "failed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
      contact_source: [
        "Facebook",
        "WhatsApp",
        "Zooga Website",
        "Event",
        "Tamar Bot",
        "Manual",
        "Tamar WhatsApp",
      ],
      contact_status: [
        "new_lead",
        "active_member",
        "interested",
        "customer",
        "VIP",
        "inactive",
      ],
      gender: ["male", "female", "other", "prefer_not_to_say"],
      imported_lead_status: [
        "imported",
        "duplicate",
        "ready_for_intake",
        "sent_to_tamar",
        "replied",
        "converted_to_contact",
        "failed",
        "opted_out",
      ],
      income_range: ["low", "medium", "high", "prefer_not_to_say"],
      intake_status: ["pending", "approved", "merged", "rejected"],
      interaction_type: [
        "facebook_message",
        "whatsapp_message",
        "link_click",
        "event_interest",
        "form_submit",
        "purchase_interest",
        "admin_note",
      ],
      lead_consent_status: ["unknown", "approved", "declined"],
      message_channel: ["Facebook", "WhatsApp", "SMS", "Email"],
      message_status: ["draft", "sent", "failed", "replied"],
      offer_category: [
        "event",
        "trip",
        "party",
        "lecture",
        "workshop",
        "digital_product",
        "membership",
      ],
      offer_status: ["draft", "active", "archived"],
      price_sensitivity: ["high", "medium", "low"],
      spending_profile: ["budget", "standard", "premium", "luxury"],
      whatsapp_template_status: [
        "not_sent",
        "sent",
        "delivered",
        "read",
        "replied",
        "failed",
      ],
    },
  },
} as const
