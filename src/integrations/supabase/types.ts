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
      campaign_contacts: {
        Row: {
          ai_reasoning: string | null
          campaign_id: string
          contact_id: string
          conversation_intent: string | null
          conversion_probability: number | null
          conversion_stage: string | null
          created_at: string
          emotional_engagement: number | null
          first_touch: boolean
          fit_score: number | null
          id: string
          intent_level: string | null
          joined_at: string
          last_activity_at: string
          last_touch: boolean
          updated_at: string
        }
        Insert: {
          ai_reasoning?: string | null
          campaign_id: string
          contact_id: string
          conversation_intent?: string | null
          conversion_probability?: number | null
          conversion_stage?: string | null
          created_at?: string
          emotional_engagement?: number | null
          first_touch?: boolean
          fit_score?: number | null
          id?: string
          intent_level?: string | null
          joined_at?: string
          last_activity_at?: string
          last_touch?: boolean
          updated_at?: string
        }
        Update: {
          ai_reasoning?: string | null
          campaign_id?: string
          contact_id?: string
          conversation_intent?: string | null
          conversion_probability?: number | null
          conversion_stage?: string | null
          created_at?: string
          emotional_engagement?: number | null
          first_touch?: boolean
          fit_score?: number | null
          id?: string
          intent_level?: string | null
          joined_at?: string
          last_activity_at?: string
          last_touch?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_contacts_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          active_from: string | null
          active_until: string | null
          ad_copy: string | null
          ai_behavior_rules: Json
          ai_goal: string | null
          campaign_type: string | null
          category: string | null
          created_at: string
          created_by: string | null
          description: string | null
          desired_conversion_action: string | null
          emotional_angle: string | null
          faq: Json
          id: string
          images: string[]
          intake_flow_type: Database["public"]["Enums"]["intake_flow_type"]
          landing_text: string | null
          manager_owner_id: string | null
          name: string
          objections: string[]
          objective: string | null
          offer_id: string | null
          prohibited_promises: string[]
          source_platform: string | null
          status: Database["public"]["Enums"]["campaign_status"]
          target_age_ranges: string[]
          target_audience: string | null
          target_personality_types: string[]
          target_regions: string[]
          tone_style: string | null
          updated_at: string
          videos: string[]
          whatsapp_number: string | null
        }
        Insert: {
          active_from?: string | null
          active_until?: string | null
          ad_copy?: string | null
          ai_behavior_rules?: Json
          ai_goal?: string | null
          campaign_type?: string | null
          category?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          desired_conversion_action?: string | null
          emotional_angle?: string | null
          faq?: Json
          id?: string
          images?: string[]
          intake_flow_type?: Database["public"]["Enums"]["intake_flow_type"]
          landing_text?: string | null
          manager_owner_id?: string | null
          name: string
          objections?: string[]
          objective?: string | null
          offer_id?: string | null
          prohibited_promises?: string[]
          source_platform?: string | null
          status?: Database["public"]["Enums"]["campaign_status"]
          target_age_ranges?: string[]
          target_audience?: string | null
          target_personality_types?: string[]
          target_regions?: string[]
          tone_style?: string | null
          updated_at?: string
          videos?: string[]
          whatsapp_number?: string | null
        }
        Update: {
          active_from?: string | null
          active_until?: string | null
          ad_copy?: string | null
          ai_behavior_rules?: Json
          ai_goal?: string | null
          campaign_type?: string | null
          category?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          desired_conversion_action?: string | null
          emotional_angle?: string | null
          faq?: Json
          id?: string
          images?: string[]
          intake_flow_type?: Database["public"]["Enums"]["intake_flow_type"]
          landing_text?: string | null
          manager_owner_id?: string | null
          name?: string
          objections?: string[]
          objective?: string | null
          offer_id?: string | null
          prohibited_promises?: string[]
          source_platform?: string | null
          status?: Database["public"]["Enums"]["campaign_status"]
          target_age_ranges?: string[]
          target_audience?: string | null
          target_personality_types?: string[]
          target_regions?: string[]
          tone_style?: string | null
          updated_at?: string
          videos?: string[]
          whatsapp_number?: string | null
        }
        Relationships: []
      }
      contact_memories: {
        Row: {
          confidence_score: number | null
          contact_id: string
          created_at: string
          extracted_from: string | null
          id: string
          memory_key: string
          memory_type: string
          memory_value: string | null
          source_message: string | null
          updated_at: string
        }
        Insert: {
          confidence_score?: number | null
          contact_id: string
          created_at?: string
          extracted_from?: string | null
          id?: string
          memory_key: string
          memory_type: string
          memory_value?: string | null
          source_message?: string | null
          updated_at?: string
        }
        Update: {
          confidence_score?: number | null
          contact_id?: string
          created_at?: string
          extracted_from?: string | null
          id?: string
          memory_key?: string
          memory_type?: string
          memory_value?: string | null
          source_message?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      contact_profile_history: {
        Row: {
          changed_by: string
          confidence_score: number | null
          contact_id: string
          created_at: string
          field_name: string
          id: string
          new_value: string | null
          old_value: string | null
          source: string | null
        }
        Insert: {
          changed_by?: string
          confidence_score?: number | null
          contact_id: string
          created_at?: string
          field_name: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          source?: string | null
        }
        Update: {
          changed_by?: string
          confidence_score?: number | null
          contact_id?: string
          created_at?: string
          field_name?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          source?: string | null
        }
        Relationships: []
      }
      contacts: {
        Row: {
          acquisition_source: string | null
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
          campaign_source: string | null
          campaigns_received: string[]
          city: string | null
          communication_style: string | null
          community_fit_score: number | null
          consent_date: string | null
          consent_marketing: boolean
          conversation_intent: string | null
          conversion_stage: string | null
          created_at: string
          decision_triggers: string[]
          dynamic_profile_fields: Json
          economic_score: number
          email: string | null
          emotional_needs: string[]
          emotional_profile: string | null
          engagement_score: number
          entry_offer_id: string | null
          events_interested: string[]
          events_joined: string[]
          facebook_id: string | null
          favorite_activity_types: string[]
          first_name: string | null
          first_touch_campaign_id: string | null
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
          last_touch_campaign_id: string | null
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
          acquisition_source?: string | null
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
          campaign_source?: string | null
          campaigns_received?: string[]
          city?: string | null
          communication_style?: string | null
          community_fit_score?: number | null
          consent_date?: string | null
          consent_marketing?: boolean
          conversation_intent?: string | null
          conversion_stage?: string | null
          created_at?: string
          decision_triggers?: string[]
          dynamic_profile_fields?: Json
          economic_score?: number
          email?: string | null
          emotional_needs?: string[]
          emotional_profile?: string | null
          engagement_score?: number
          entry_offer_id?: string | null
          events_interested?: string[]
          events_joined?: string[]
          facebook_id?: string | null
          favorite_activity_types?: string[]
          first_name?: string | null
          first_touch_campaign_id?: string | null
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
          last_touch_campaign_id?: string | null
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
          acquisition_source?: string | null
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
          campaign_source?: string | null
          campaigns_received?: string[]
          city?: string | null
          communication_style?: string | null
          community_fit_score?: number | null
          consent_date?: string | null
          consent_marketing?: boolean
          conversation_intent?: string | null
          conversion_stage?: string | null
          created_at?: string
          decision_triggers?: string[]
          dynamic_profile_fields?: Json
          economic_score?: number
          email?: string | null
          emotional_needs?: string[]
          emotional_profile?: string | null
          engagement_score?: number
          entry_offer_id?: string | null
          events_interested?: string[]
          events_joined?: string[]
          facebook_id?: string | null
          favorite_activity_types?: string[]
          first_name?: string | null
          first_touch_campaign_id?: string | null
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
          last_touch_campaign_id?: string | null
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
      extracted_attributes: {
        Row: {
          applied: boolean
          applied_at: string | null
          attribute_name: string
          attribute_value: Json
          confidence_score: number
          contact_id: string
          created_at: string
          extracted_by: string
          id: string
          is_current: boolean
          model: string | null
          reasoning: string | null
          source: string
          source_interaction_id: string | null
          source_message: string | null
          superseded_at: string | null
          superseded_by: string | null
          value_text: string | null
        }
        Insert: {
          applied?: boolean
          applied_at?: string | null
          attribute_name: string
          attribute_value: Json
          confidence_score?: number
          contact_id: string
          created_at?: string
          extracted_by?: string
          id?: string
          is_current?: boolean
          model?: string | null
          reasoning?: string | null
          source?: string
          source_interaction_id?: string | null
          source_message?: string | null
          superseded_at?: string | null
          superseded_by?: string | null
          value_text?: string | null
        }
        Update: {
          applied?: boolean
          applied_at?: string | null
          attribute_name?: string
          attribute_value?: Json
          confidence_score?: number
          contact_id?: string
          created_at?: string
          extracted_by?: string
          id?: string
          is_current?: boolean
          model?: string | null
          reasoning?: string | null
          source?: string
          source_interaction_id?: string | null
          source_message?: string | null
          superseded_at?: string | null
          superseded_by?: string | null
          value_text?: string | null
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
          campaign_id: string | null
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
          campaign_id?: string | null
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
          campaign_id?: string | null
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
      pending_ai_insights: {
        Row: {
          category: string
          confidence_score: number | null
          contact_id: string
          created_at: string
          field_name: string | null
          id: string
          proposed_value: Json | null
          reasoning: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          source_message: string | null
          status: string
        }
        Insert: {
          category: string
          confidence_score?: number | null
          contact_id: string
          created_at?: string
          field_name?: string | null
          id?: string
          proposed_value?: Json | null
          reasoning?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_message?: string | null
          status?: string
        }
        Update: {
          category?: string
          confidence_score?: number | null
          contact_id?: string
          created_at?: string
          field_name?: string | null
          id?: string
          proposed_value?: Json | null
          reasoning?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_message?: string | null
          status?: string
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
      campaign_status: "draft" | "active" | "paused" | "completed" | "archived"
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
      intake_flow_type:
        | "trip"
        | "event"
        | "party"
        | "dating"
        | "workshop"
        | "vip"
        | "community"
        | "sales_inquiry"
        | "generic"
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
      campaign_status: ["draft", "active", "paused", "completed", "archived"],
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
      intake_flow_type: [
        "trip",
        "event",
        "party",
        "dating",
        "workshop",
        "vip",
        "community",
        "sales_inquiry",
        "generic",
      ],
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
