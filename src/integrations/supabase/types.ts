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
          updated_at: string
          webhook_token: string | null
        }
        Insert: {
          default_source?: Database["public"]["Enums"]["contact_source"]
          facebook_page_id?: string | null
          id?: number
          updated_at?: string
          webhook_token?: string | null
        }
        Update: {
          default_source?: Database["public"]["Enums"]["contact_source"]
          facebook_page_id?: string | null
          id?: number
          updated_at?: string
          webhook_token?: string | null
        }
        Relationships: []
      }
      contacts: {
        Row: {
          ai_confidence_score: number | null
          ai_offer_fit: string | null
          ai_profile_notes: string | null
          ai_recommended_next_action: string | null
          ai_risk_flags: string | null
          ai_summary: string | null
          birth_date: string | null
          birthday_day: number | null
          birthday_month: number | null
          birthday_year: number | null
          city: string | null
          consent_date: string | null
          consent_marketing: boolean
          created_at: string
          economic_score: number
          email: string | null
          engagement_score: number
          facebook_id: string | null
          first_name: string | null
          full_name: string | null
          gender: Database["public"]["Enums"]["gender"] | null
          id: string
          income_range: Database["public"]["Enums"]["income_range"] | null
          interests: string[]
          last_interaction_at: string | null
          last_name: string | null
          lifestyle_tags: string[]
          notes: string | null
          phone: string | null
          price_sensitivity:
            | Database["public"]["Enums"]["price_sensitivity"]
            | null
          region: string | null
          relationship_status: string | null
          source: Database["public"]["Enums"]["contact_source"] | null
          spending_profile:
            | Database["public"]["Enums"]["spending_profile"]
            | null
          status: Database["public"]["Enums"]["contact_status"]
          tags: string[]
          updated_at: string
          whatsapp_number: string | null
        }
        Insert: {
          ai_confidence_score?: number | null
          ai_offer_fit?: string | null
          ai_profile_notes?: string | null
          ai_recommended_next_action?: string | null
          ai_risk_flags?: string | null
          ai_summary?: string | null
          birth_date?: string | null
          birthday_day?: number | null
          birthday_month?: number | null
          birthday_year?: number | null
          city?: string | null
          consent_date?: string | null
          consent_marketing?: boolean
          created_at?: string
          economic_score?: number
          email?: string | null
          engagement_score?: number
          facebook_id?: string | null
          first_name?: string | null
          full_name?: string | null
          gender?: Database["public"]["Enums"]["gender"] | null
          id?: string
          income_range?: Database["public"]["Enums"]["income_range"] | null
          interests?: string[]
          last_interaction_at?: string | null
          last_name?: string | null
          lifestyle_tags?: string[]
          notes?: string | null
          phone?: string | null
          price_sensitivity?:
            | Database["public"]["Enums"]["price_sensitivity"]
            | null
          region?: string | null
          relationship_status?: string | null
          source?: Database["public"]["Enums"]["contact_source"] | null
          spending_profile?:
            | Database["public"]["Enums"]["spending_profile"]
            | null
          status?: Database["public"]["Enums"]["contact_status"]
          tags?: string[]
          updated_at?: string
          whatsapp_number?: string | null
        }
        Update: {
          ai_confidence_score?: number | null
          ai_offer_fit?: string | null
          ai_profile_notes?: string | null
          ai_recommended_next_action?: string | null
          ai_risk_flags?: string | null
          ai_summary?: string | null
          birth_date?: string | null
          birthday_day?: number | null
          birthday_month?: number | null
          birthday_year?: number | null
          city?: string | null
          consent_date?: string | null
          consent_marketing?: boolean
          created_at?: string
          economic_score?: number
          email?: string | null
          engagement_score?: number
          facebook_id?: string | null
          first_name?: string | null
          full_name?: string | null
          gender?: Database["public"]["Enums"]["gender"] | null
          id?: string
          income_range?: Database["public"]["Enums"]["income_range"] | null
          interests?: string[]
          last_interaction_at?: string | null
          last_name?: string | null
          lifestyle_tags?: string[]
          notes?: string | null
          phone?: string | null
          price_sensitivity?:
            | Database["public"]["Enums"]["price_sensitivity"]
            | null
          region?: string | null
          relationship_status?: string | null
          source?: Database["public"]["Enums"]["contact_source"] | null
          spending_profile?:
            | Database["public"]["Enums"]["spending_profile"]
            | null
          status?: Database["public"]["Enums"]["contact_status"]
          tags?: string[]
          updated_at?: string
          whatsapp_number?: string | null
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
      contact_status:
        | "new_lead"
        | "active_member"
        | "interested"
        | "customer"
        | "VIP"
        | "inactive"
      gender: "male" | "female" | "other" | "prefer_not_to_say"
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
    },
  },
} as const
