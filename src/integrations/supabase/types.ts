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
      ai_assistant_runs: {
        Row: {
          completed_at: string | null
          context_used: Json | null
          created_at: string
          created_by: string | null
          error: string | null
          id: string
          model: string | null
          prompt: string
          request_type: string
          response: string | null
          status: string
        }
        Insert: {
          completed_at?: string | null
          context_used?: Json | null
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          model?: string | null
          prompt: string
          request_type?: string
          response?: string | null
          status?: string
        }
        Update: {
          completed_at?: string | null
          context_used?: Json | null
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          model?: string | null
          prompt?: string
          request_type?: string
          response?: string | null
          status?: string
        }
        Relationships: []
      }
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
          attempts: number
          campaign_id: string | null
          contact_id: string
          conversation_intent: string | null
          conversion_probability: number | null
          conversion_stage: string | null
          created_at: string
          delivered_at: string | null
          emotional_engagement: number | null
          first_touch: boolean
          fit_score: number | null
          id: string
          idempotency_key: string | null
          imported_lead_id: string | null
          intake_campaign_id: string | null
          intent_level: string | null
          joined_at: string
          last_activity_at: string
          last_error: string | null
          last_touch: boolean
          offer_id: string | null
          opted_out_at: string | null
          provider_message_id: string | null
          read_at: string | null
          replied_at: string | null
          send_state: string
          sent_at: string | null
          updated_at: string
        }
        Insert: {
          ai_reasoning?: string | null
          attempts?: number
          campaign_id?: string | null
          contact_id: string
          conversation_intent?: string | null
          conversion_probability?: number | null
          conversion_stage?: string | null
          created_at?: string
          delivered_at?: string | null
          emotional_engagement?: number | null
          first_touch?: boolean
          fit_score?: number | null
          id?: string
          idempotency_key?: string | null
          imported_lead_id?: string | null
          intake_campaign_id?: string | null
          intent_level?: string | null
          joined_at?: string
          last_activity_at?: string
          last_error?: string | null
          last_touch?: boolean
          offer_id?: string | null
          opted_out_at?: string | null
          provider_message_id?: string | null
          read_at?: string | null
          replied_at?: string | null
          send_state?: string
          sent_at?: string | null
          updated_at?: string
        }
        Update: {
          ai_reasoning?: string | null
          attempts?: number
          campaign_id?: string | null
          contact_id?: string
          conversation_intent?: string | null
          conversion_probability?: number | null
          conversion_stage?: string | null
          created_at?: string
          delivered_at?: string | null
          emotional_engagement?: number | null
          first_touch?: boolean
          fit_score?: number | null
          id?: string
          idempotency_key?: string | null
          imported_lead_id?: string | null
          intake_campaign_id?: string | null
          intent_level?: string | null
          joined_at?: string
          last_activity_at?: string
          last_error?: string | null
          last_touch?: boolean
          offer_id?: string | null
          opted_out_at?: string | null
          provider_message_id?: string | null
          read_at?: string | null
          replied_at?: string | null
          send_state?: string
          sent_at?: string | null
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
          {
            foreignKeyName: "campaign_contacts_imported_lead_id_fkey"
            columns: ["imported_lead_id"]
            isOneToOne: false
            referencedRelation: "imported_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_contacts_intake_campaign_id_fkey"
            columns: ["intake_campaign_id"]
            isOneToOne: false
            referencedRelation: "intake_campaigns"
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
      community_knowledge_chunks: {
        Row: {
          chunk_index: number
          content: string
          created_at: string
          id: string
          source_id: string
          status: string
          tags: string[]
        }
        Insert: {
          chunk_index?: number
          content: string
          created_at?: string
          id?: string
          source_id: string
          status?: string
          tags?: string[]
        }
        Update: {
          chunk_index?: number
          content?: string
          created_at?: string
          id?: string
          source_id?: string
          status?: string
          tags?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "community_knowledge_chunks_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "community_knowledge_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      community_knowledge_sources: {
        Row: {
          created_at: string
          fetched_at: string | null
          id: string
          notes: string | null
          public_or_authorized: string
          source_type: string
          source_url: string | null
          status: string
          title: string
          updated_at: string
          verified_at: string | null
          verified_by: string | null
          version: number
        }
        Insert: {
          created_at?: string
          fetched_at?: string | null
          id?: string
          notes?: string | null
          public_or_authorized?: string
          source_type?: string
          source_url?: string | null
          status?: string
          title: string
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
          version?: number
        }
        Update: {
          created_at?: string
          fetched_at?: string | null
          id?: string
          notes?: string | null
          public_or_authorized?: string
          source_type?: string
          source_url?: string | null
          status?: string
          title?: string
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
          version?: number
        }
        Relationships: []
      }
      contact_identity_registry: {
        Row: {
          archived_at: string | null
          contact_id: string | null
          created_at: string
          first_seen_at: string
          id: string
          identity_type: string
          last_seen_at: string
          merged_into: string | null
          metadata: Json
          normalized_value: string
          source: string | null
          updated_at: string
          value_hash: string
        }
        Insert: {
          archived_at?: string | null
          contact_id?: string | null
          created_at?: string
          first_seen_at?: string
          id?: string
          identity_type?: string
          last_seen_at?: string
          merged_into?: string | null
          metadata?: Json
          normalized_value: string
          source?: string | null
          updated_at?: string
          value_hash: string
        }
        Update: {
          archived_at?: string | null
          contact_id?: string | null
          created_at?: string
          first_seen_at?: string
          id?: string
          identity_type?: string
          last_seen_at?: string
          merged_into?: string | null
          metadata?: Json
          normalized_value?: string
          source?: string | null
          updated_at?: string
          value_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_identity_registry_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_identity_registry_merged_into_fkey"
            columns: ["merged_into"]
            isOneToOne: false
            referencedRelation: "contact_identity_registry"
            referencedColumns: ["id"]
          },
        ]
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
      contact_profile_facts: {
        Row: {
          confidence: number
          contact_id: string
          created_at: string
          evidence: string | null
          explicit_or_inferred: string
          field_key: string
          id: string
          is_current: boolean
          observed_at: string
          source: string
          source_message_id: string | null
          superseded_by: string | null
          updated_at: string
          value_json: Json | null
          value_text: string | null
        }
        Insert: {
          confidence?: number
          contact_id: string
          created_at?: string
          evidence?: string | null
          explicit_or_inferred?: string
          field_key: string
          id?: string
          is_current?: boolean
          observed_at?: string
          source?: string
          source_message_id?: string | null
          superseded_by?: string | null
          updated_at?: string
          value_json?: Json | null
          value_text?: string | null
        }
        Update: {
          confidence?: number
          contact_id?: string
          created_at?: string
          evidence?: string | null
          explicit_or_inferred?: string
          field_key?: string
          id?: string
          is_current?: boolean
          observed_at?: string
          source?: string
          source_message_id?: string | null
          superseded_by?: string | null
          updated_at?: string
          value_json?: Json | null
          value_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contact_profile_facts_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
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
          ambiguity_turns: number
          archive_reason: string | null
          archived_at: string | null
          availability_preferences: string[]
          baseline_intake_status: string
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
          consent_asked_at: string | null
          consent_date: string | null
          consent_evidence: Json
          consent_marketing: boolean
          consent_message_id: string | null
          consent_responded_at: string | null
          consent_source: string | null
          consent_status: string
          consent_version: string | null
          consent_wording_version: string | null
          conversation_intent: string | null
          conversation_state:
            | Database["public"]["Enums"]["tamar_conversation_state"]
            | null
          conversation_state_at: string | null
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
          first_inbound_at: string | null
          first_name: string | null
          first_seen_at: string | null
          first_touch_campaign_id: string | null
          full_name: string | null
          gender: Database["public"]["Enums"]["gender"] | null
          has_prior_conversation: boolean
          hobbies: string[]
          human_owned: boolean
          human_owned_at: string | null
          human_owned_by: string | null
          id: string
          income_range: Database["public"]["Enums"]["income_range"] | null
          intake_completed_at: string | null
          intake_completed_fields: string[] | null
          intake_completion_score: number | null
          intake_last_captured_at: string | null
          intake_last_captured_field: string | null
          intake_last_question_at: string | null
          intake_last_question_key: string | null
          intake_last_step_id: string | null
          intake_missing_fields: string[] | null
          intake_required_fields: string[] | null
          intake_stage: string | null
          intake_started_at: string | null
          intake_state: string | null
          intake_status: string | null
          intake_version: number
          interaction_count: number
          interests: string[]
          last_campaign: string | null
          last_clicked_offer: string | null
          last_inbound_at: string | null
          last_interaction_at: string | null
          last_name: string | null
          last_outbound_at: string | null
          last_presented_offers: Json
          last_presented_offers_at: string | null
          last_touch_campaign_id: string | null
          last_trip_destination: string | null
          lifestyle_tags: string[]
          likely_needs: string[]
          likes_travel: string | null
          loneliness_signal: string | null
          looking_for_relationship: string | null
          manager_attention_required: boolean
          next_best_offer: string | null
          notes: string | null
          objections: string[]
          offers_sent: string[]
          opening_asked_at: string | null
          opening_deferred_at: string | null
          opening_responded_at: string | null
          opening_status: string
          openness_score: number | null
          opted_out_at: string | null
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
          relationship_intake_deferred_at: string | null
          relationship_intake_offered_at: string | null
          relationship_intake_ready_at: string | null
          relationship_intake_status: string
          relationship_readiness: string | null
          relationship_status: string | null
          residence_city: string | null
          sales_profile: string | null
          sales_temperature: string | null
          service_window_open_until: string | null
          social_goals: string[]
          social_profile: string | null
          source: Database["public"]["Enums"]["contact_source"] | null
          spending_profile:
            | Database["public"]["Enums"]["spending_profile"]
            | null
          status: Database["public"]["Enums"]["contact_status"]
          tags: string[]
          tamar_agent_version: number | null
          total_messages: number
          total_revenue: number
          travel_preferences: string[]
          travel_scope: string | null
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
          ambiguity_turns?: number
          archive_reason?: string | null
          archived_at?: string | null
          availability_preferences?: string[]
          baseline_intake_status?: string
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
          consent_asked_at?: string | null
          consent_date?: string | null
          consent_evidence?: Json
          consent_marketing?: boolean
          consent_message_id?: string | null
          consent_responded_at?: string | null
          consent_source?: string | null
          consent_status?: string
          consent_version?: string | null
          consent_wording_version?: string | null
          conversation_intent?: string | null
          conversation_state?:
            | Database["public"]["Enums"]["tamar_conversation_state"]
            | null
          conversation_state_at?: string | null
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
          first_inbound_at?: string | null
          first_name?: string | null
          first_seen_at?: string | null
          first_touch_campaign_id?: string | null
          full_name?: string | null
          gender?: Database["public"]["Enums"]["gender"] | null
          has_prior_conversation?: boolean
          hobbies?: string[]
          human_owned?: boolean
          human_owned_at?: string | null
          human_owned_by?: string | null
          id?: string
          income_range?: Database["public"]["Enums"]["income_range"] | null
          intake_completed_at?: string | null
          intake_completed_fields?: string[] | null
          intake_completion_score?: number | null
          intake_last_captured_at?: string | null
          intake_last_captured_field?: string | null
          intake_last_question_at?: string | null
          intake_last_question_key?: string | null
          intake_last_step_id?: string | null
          intake_missing_fields?: string[] | null
          intake_required_fields?: string[] | null
          intake_stage?: string | null
          intake_started_at?: string | null
          intake_state?: string | null
          intake_status?: string | null
          intake_version?: number
          interaction_count?: number
          interests?: string[]
          last_campaign?: string | null
          last_clicked_offer?: string | null
          last_inbound_at?: string | null
          last_interaction_at?: string | null
          last_name?: string | null
          last_outbound_at?: string | null
          last_presented_offers?: Json
          last_presented_offers_at?: string | null
          last_touch_campaign_id?: string | null
          last_trip_destination?: string | null
          lifestyle_tags?: string[]
          likely_needs?: string[]
          likes_travel?: string | null
          loneliness_signal?: string | null
          looking_for_relationship?: string | null
          manager_attention_required?: boolean
          next_best_offer?: string | null
          notes?: string | null
          objections?: string[]
          offers_sent?: string[]
          opening_asked_at?: string | null
          opening_deferred_at?: string | null
          opening_responded_at?: string | null
          opening_status?: string
          openness_score?: number | null
          opted_out_at?: string | null
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
          relationship_intake_deferred_at?: string | null
          relationship_intake_offered_at?: string | null
          relationship_intake_ready_at?: string | null
          relationship_intake_status?: string
          relationship_readiness?: string | null
          relationship_status?: string | null
          residence_city?: string | null
          sales_profile?: string | null
          sales_temperature?: string | null
          service_window_open_until?: string | null
          social_goals?: string[]
          social_profile?: string | null
          source?: Database["public"]["Enums"]["contact_source"] | null
          spending_profile?:
            | Database["public"]["Enums"]["spending_profile"]
            | null
          status?: Database["public"]["Enums"]["contact_status"]
          tags?: string[]
          tamar_agent_version?: number | null
          total_messages?: number
          total_revenue?: number
          travel_preferences?: string[]
          travel_scope?: string | null
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
          ambiguity_turns?: number
          archive_reason?: string | null
          archived_at?: string | null
          availability_preferences?: string[]
          baseline_intake_status?: string
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
          consent_asked_at?: string | null
          consent_date?: string | null
          consent_evidence?: Json
          consent_marketing?: boolean
          consent_message_id?: string | null
          consent_responded_at?: string | null
          consent_source?: string | null
          consent_status?: string
          consent_version?: string | null
          consent_wording_version?: string | null
          conversation_intent?: string | null
          conversation_state?:
            | Database["public"]["Enums"]["tamar_conversation_state"]
            | null
          conversation_state_at?: string | null
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
          first_inbound_at?: string | null
          first_name?: string | null
          first_seen_at?: string | null
          first_touch_campaign_id?: string | null
          full_name?: string | null
          gender?: Database["public"]["Enums"]["gender"] | null
          has_prior_conversation?: boolean
          hobbies?: string[]
          human_owned?: boolean
          human_owned_at?: string | null
          human_owned_by?: string | null
          id?: string
          income_range?: Database["public"]["Enums"]["income_range"] | null
          intake_completed_at?: string | null
          intake_completed_fields?: string[] | null
          intake_completion_score?: number | null
          intake_last_captured_at?: string | null
          intake_last_captured_field?: string | null
          intake_last_question_at?: string | null
          intake_last_question_key?: string | null
          intake_last_step_id?: string | null
          intake_missing_fields?: string[] | null
          intake_required_fields?: string[] | null
          intake_stage?: string | null
          intake_started_at?: string | null
          intake_state?: string | null
          intake_status?: string | null
          intake_version?: number
          interaction_count?: number
          interests?: string[]
          last_campaign?: string | null
          last_clicked_offer?: string | null
          last_inbound_at?: string | null
          last_interaction_at?: string | null
          last_name?: string | null
          last_outbound_at?: string | null
          last_presented_offers?: Json
          last_presented_offers_at?: string | null
          last_touch_campaign_id?: string | null
          last_trip_destination?: string | null
          lifestyle_tags?: string[]
          likely_needs?: string[]
          likes_travel?: string | null
          loneliness_signal?: string | null
          looking_for_relationship?: string | null
          manager_attention_required?: boolean
          next_best_offer?: string | null
          notes?: string | null
          objections?: string[]
          offers_sent?: string[]
          opening_asked_at?: string | null
          opening_deferred_at?: string | null
          opening_responded_at?: string | null
          opening_status?: string
          openness_score?: number | null
          opted_out_at?: string | null
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
          relationship_intake_deferred_at?: string | null
          relationship_intake_offered_at?: string | null
          relationship_intake_ready_at?: string | null
          relationship_intake_status?: string
          relationship_readiness?: string | null
          relationship_status?: string | null
          residence_city?: string | null
          sales_profile?: string | null
          sales_temperature?: string | null
          service_window_open_until?: string | null
          social_goals?: string[]
          social_profile?: string | null
          source?: Database["public"]["Enums"]["contact_source"] | null
          spending_profile?:
            | Database["public"]["Enums"]["spending_profile"]
            | null
          status?: Database["public"]["Enums"]["contact_status"]
          tags?: string[]
          tamar_agent_version?: number | null
          total_messages?: number
          total_revenue?: number
          travel_preferences?: string[]
          travel_scope?: string | null
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
          attempts: number
          consent_at: string | null
          consent_source: string | null
          consent_status: Database["public"]["Enums"]["lead_consent_status"]
          contact_id: string | null
          created_at: string
          delivered_at: string | null
          first_name: string | null
          full_name: string | null
          id: string
          import_status: Database["public"]["Enums"]["imported_lead_status"]
          intake_campaign_id: string | null
          last_error: string | null
          last_message_at: string | null
          last_name: string | null
          notes: string | null
          opted_out_at: string | null
          phone: string | null
          provider_message_id: string | null
          raw_row_data: Json | null
          read_at: string | null
          replied_at: string | null
          send_state: string
          sent_at: string | null
          source_campaign: string | null
          source_file_name: string | null
          updated_at: string
          whatsapp_template_status: Database["public"]["Enums"]["whatsapp_template_status"]
        }
        Insert: {
          attempts?: number
          consent_at?: string | null
          consent_source?: string | null
          consent_status?: Database["public"]["Enums"]["lead_consent_status"]
          contact_id?: string | null
          created_at?: string
          delivered_at?: string | null
          first_name?: string | null
          full_name?: string | null
          id?: string
          import_status?: Database["public"]["Enums"]["imported_lead_status"]
          intake_campaign_id?: string | null
          last_error?: string | null
          last_message_at?: string | null
          last_name?: string | null
          notes?: string | null
          opted_out_at?: string | null
          phone?: string | null
          provider_message_id?: string | null
          raw_row_data?: Json | null
          read_at?: string | null
          replied_at?: string | null
          send_state?: string
          sent_at?: string | null
          source_campaign?: string | null
          source_file_name?: string | null
          updated_at?: string
          whatsapp_template_status?: Database["public"]["Enums"]["whatsapp_template_status"]
        }
        Update: {
          attempts?: number
          consent_at?: string | null
          consent_source?: string | null
          consent_status?: Database["public"]["Enums"]["lead_consent_status"]
          contact_id?: string | null
          created_at?: string
          delivered_at?: string | null
          first_name?: string | null
          full_name?: string | null
          id?: string
          import_status?: Database["public"]["Enums"]["imported_lead_status"]
          intake_campaign_id?: string | null
          last_error?: string | null
          last_message_at?: string | null
          last_name?: string | null
          notes?: string | null
          opted_out_at?: string | null
          phone?: string | null
          provider_message_id?: string | null
          raw_row_data?: Json | null
          read_at?: string | null
          replied_at?: string | null
          send_state?: string
          sent_at?: string | null
          source_campaign?: string | null
          source_file_name?: string | null
          updated_at?: string
          whatsapp_template_status?: Database["public"]["Enums"]["whatsapp_template_status"]
        }
        Relationships: []
      }
      inbound_event_vault: {
        Row: {
          attempt_count: number
          claimed_at: string | null
          claimed_by: string | null
          contact_id: string | null
          correlation_id: string
          created_at: string
          dedupe_key: string
          event_type: string
          id: string
          last_error_code: string | null
          last_error_message: string | null
          next_retry_at: string | null
          normalized_phone: string | null
          payload_sha256: string
          phone_hash: string | null
          processed_at: string | null
          processing_status: string
          provider: string
          provider_event_id: string | null
          raw_payload: Json
          received_at: string
        }
        Insert: {
          attempt_count?: number
          claimed_at?: string | null
          claimed_by?: string | null
          contact_id?: string | null
          correlation_id?: string
          created_at?: string
          dedupe_key: string
          event_type?: string
          id?: string
          last_error_code?: string | null
          last_error_message?: string | null
          next_retry_at?: string | null
          normalized_phone?: string | null
          payload_sha256: string
          phone_hash?: string | null
          processed_at?: string | null
          processing_status?: string
          provider?: string
          provider_event_id?: string | null
          raw_payload: Json
          received_at?: string
        }
        Update: {
          attempt_count?: number
          claimed_at?: string | null
          claimed_by?: string | null
          contact_id?: string | null
          correlation_id?: string
          created_at?: string
          dedupe_key?: string
          event_type?: string
          id?: string
          last_error_code?: string | null
          last_error_message?: string | null
          next_retry_at?: string | null
          normalized_phone?: string | null
          payload_sha256?: string
          phone_hash?: string | null
          processed_at?: string | null
          processing_status?: string
          provider?: string
          provider_event_id?: string | null
          raw_payload?: Json
          received_at?: string
        }
        Relationships: []
      }
      intake_campaigns: {
        Row: {
          batch_size: number
          campaign_name: string
          control_state: string
          created_at: string
          created_by: string | null
          failed_count: number
          id: string
          language_code: string
          offer_id: string | null
          sent_count: number
          skipped_count: number
          status: string
          tamar_response: Json | null
          template_name: string
          total_count: number
          updated_at: string
        }
        Insert: {
          batch_size?: number
          campaign_name: string
          control_state?: string
          created_at?: string
          created_by?: string | null
          failed_count?: number
          id?: string
          language_code?: string
          offer_id?: string | null
          sent_count?: number
          skipped_count?: number
          status?: string
          tamar_response?: Json | null
          template_name: string
          total_count?: number
          updated_at?: string
        }
        Update: {
          batch_size?: number
          campaign_name?: string
          control_state?: string
          created_at?: string
          created_by?: string | null
          failed_count?: number
          id?: string
          language_code?: string
          offer_id?: string | null
          sent_count?: number
          skipped_count?: number
          status?: string
          tamar_response?: Json | null
          template_name?: string
          total_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      intake_field_captures: {
        Row: {
          confidence: number | null
          contact_id: string
          created_at: string
          field_key: string
          id: string
          runtime_execution_id: string | null
          source: string | null
          value_text: string | null
        }
        Insert: {
          confidence?: number | null
          contact_id: string
          created_at?: string
          field_key: string
          id?: string
          runtime_execution_id?: string | null
          source?: string | null
          value_text?: string | null
        }
        Update: {
          confidence?: number | null
          contact_id?: string
          created_at?: string
          field_key?: string
          id?: string
          runtime_execution_id?: string | null
          source?: string | null
          value_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "intake_field_captures_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      intake_field_definitions: {
        Row: {
          created_at: string
          depends_on: Json
          enabled: boolean
          field_key: string
          id: string
          intake_version: number
          label: string
          options: Json
          order_index: number
          presentation: string
          purpose_text: string | null
          question_text: string
          required: boolean
          skippable: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          depends_on?: Json
          enabled?: boolean
          field_key: string
          id?: string
          intake_version?: number
          label: string
          options?: Json
          order_index?: number
          presentation?: string
          purpose_text?: string | null
          question_text: string
          required?: boolean
          skippable?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          depends_on?: Json
          enabled?: boolean
          field_key?: string
          id?: string
          intake_version?: number
          label?: string
          options?: Json
          order_index?: number
          presentation?: string
          purpose_text?: string | null
          question_text?: string
          required?: boolean
          skippable?: boolean
          updated_at?: string
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
      manager_handoffs: {
        Row: {
          alert_error: string | null
          alert_payload: Json | null
          alert_response: Json | null
          alert_state: string
          claimed_at: string | null
          contact_id: string | null
          conversation_excerpt: Json
          conversation_mode: string | null
          conversation_mode_reasons: Json | null
          created_at: string
          crm_link: string | null
          customer_name: string | null
          customer_phone: string | null
          delivery_attempts: number
          delivery_promise: string | null
          escalation_count: number
          handoff_reason: string | null
          id: string
          idempotency_key: string | null
          last_customer_message_at: string | null
          last_escalated_at: string | null
          last_http_status: number | null
          latest_inbound_message: string | null
          manager_notified: boolean
          notes: Json
          notified_at: string | null
          notified_manager_id: string | null
          resolved_at: string | null
          resolved_campaign_id: string | null
          resolved_offer_id: string | null
          runtime_trace_id: string | null
          status: string
          suggested_response: string | null
          transcript_included: boolean
          updated_at: string
          urgency: string
        }
        Insert: {
          alert_error?: string | null
          alert_payload?: Json | null
          alert_response?: Json | null
          alert_state?: string
          claimed_at?: string | null
          contact_id?: string | null
          conversation_excerpt?: Json
          conversation_mode?: string | null
          conversation_mode_reasons?: Json | null
          created_at?: string
          crm_link?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          delivery_attempts?: number
          delivery_promise?: string | null
          escalation_count?: number
          handoff_reason?: string | null
          id?: string
          idempotency_key?: string | null
          last_customer_message_at?: string | null
          last_escalated_at?: string | null
          last_http_status?: number | null
          latest_inbound_message?: string | null
          manager_notified?: boolean
          notes?: Json
          notified_at?: string | null
          notified_manager_id?: string | null
          resolved_at?: string | null
          resolved_campaign_id?: string | null
          resolved_offer_id?: string | null
          runtime_trace_id?: string | null
          status?: string
          suggested_response?: string | null
          transcript_included?: boolean
          updated_at?: string
          urgency?: string
        }
        Update: {
          alert_error?: string | null
          alert_payload?: Json | null
          alert_response?: Json | null
          alert_state?: string
          claimed_at?: string | null
          contact_id?: string | null
          conversation_excerpt?: Json
          conversation_mode?: string | null
          conversation_mode_reasons?: Json | null
          created_at?: string
          crm_link?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          delivery_attempts?: number
          delivery_promise?: string | null
          escalation_count?: number
          handoff_reason?: string | null
          id?: string
          idempotency_key?: string | null
          last_customer_message_at?: string | null
          last_escalated_at?: string | null
          last_http_status?: number | null
          latest_inbound_message?: string | null
          manager_notified?: boolean
          notes?: Json
          notified_at?: string | null
          notified_manager_id?: string | null
          resolved_at?: string | null
          resolved_campaign_id?: string | null
          resolved_offer_id?: string | null
          runtime_trace_id?: string | null
          status?: string
          suggested_response?: string | null
          transcript_included?: boolean
          updated_at?: string
          urgency?: string
        }
        Relationships: []
      }
      managers: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          notes: string | null
          phone: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          phone: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          phone?: string
          updated_at?: string
        }
        Relationships: []
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
          {
            foreignKeyName: "messages_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "offers_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "offers_sellable"
            referencedColumns: ["id"]
          },
        ]
      }
      offers: {
        Row: {
          ai_summary: string | null
          base_price_per_person: number | null
          category: Database["public"]["Enums"]["offer_category"]
          couple_price: number | null
          created_at: string
          currency: string
          description: string | null
          escalation_boundary: Json
          event_date: string | null
          event_end_date: string | null
          extraction_raw: Json | null
          faq_bundle: Json
          flights_included: boolean | null
          grounded_facts: Json
          id: string
          included: Json
          ingestion_status: string
          itinerary_summary: string | null
          last_ingested_at: string | null
          matching_tags: string[]
          needs_date_review: boolean
          nights: number | null
          not_included: Json
          objection_notes: Json
          offer_url: string | null
          price: number | null
          price_basis: string | null
          pricing_status: string | null
          rooming_policy: string | null
          sales_angle: string | null
          single_supplement: number | null
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
          ai_summary?: string | null
          base_price_per_person?: number | null
          category: Database["public"]["Enums"]["offer_category"]
          couple_price?: number | null
          created_at?: string
          currency?: string
          description?: string | null
          escalation_boundary?: Json
          event_date?: string | null
          event_end_date?: string | null
          extraction_raw?: Json | null
          faq_bundle?: Json
          flights_included?: boolean | null
          grounded_facts?: Json
          id?: string
          included?: Json
          ingestion_status?: string
          itinerary_summary?: string | null
          last_ingested_at?: string | null
          matching_tags?: string[]
          needs_date_review?: boolean
          nights?: number | null
          not_included?: Json
          objection_notes?: Json
          offer_url?: string | null
          price?: number | null
          price_basis?: string | null
          pricing_status?: string | null
          rooming_policy?: string | null
          sales_angle?: string | null
          single_supplement?: number | null
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
          ai_summary?: string | null
          base_price_per_person?: number | null
          category?: Database["public"]["Enums"]["offer_category"]
          couple_price?: number | null
          created_at?: string
          currency?: string
          description?: string | null
          escalation_boundary?: Json
          event_date?: string | null
          event_end_date?: string | null
          extraction_raw?: Json | null
          faq_bundle?: Json
          flights_included?: boolean | null
          grounded_facts?: Json
          id?: string
          included?: Json
          ingestion_status?: string
          itinerary_summary?: string | null
          last_ingested_at?: string | null
          matching_tags?: string[]
          needs_date_review?: boolean
          nights?: number | null
          not_included?: Json
          objection_notes?: Json
          offer_url?: string | null
          price?: number | null
          price_basis?: string | null
          pricing_status?: string | null
          rooming_policy?: string | null
          sales_angle?: string | null
          single_supplement?: number | null
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
      onboarding_events: {
        Row: {
          button_id: string | null
          button_title: string | null
          contact_id: string
          created_at: string
          event_type: string
          id: string
          payload: Json
          source_message_id: string | null
          stage: string | null
        }
        Insert: {
          button_id?: string | null
          button_title?: string | null
          contact_id: string
          created_at?: string
          event_type: string
          id?: string
          payload?: Json
          source_message_id?: string | null
          stage?: string | null
        }
        Update: {
          button_id?: string | null
          button_title?: string | null
          contact_id?: string
          created_at?: string
          event_type?: string
          id?: string
          payload?: Json
          source_message_id?: string | null
          stage?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_events_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      opening_templates: {
        Row: {
          body_text: string
          buttons: Json
          created_at: string
          id: string
          is_default: boolean
          language_code: string
          meta_checked_at: string | null
          meta_status: string | null
          notes: string | null
          status: string
          template_name: string
          updated_at: string
          variable_count: number
        }
        Insert: {
          body_text: string
          buttons?: Json
          created_at?: string
          id?: string
          is_default?: boolean
          language_code?: string
          meta_checked_at?: string | null
          meta_status?: string | null
          notes?: string | null
          status?: string
          template_name: string
          updated_at?: string
          variable_count?: number
        }
        Update: {
          body_text?: string
          buttons?: Json
          created_at?: string
          id?: string
          is_default?: boolean
          language_code?: string
          meta_checked_at?: string | null
          meta_status?: string | null
          notes?: string | null
          status?: string
          template_name?: string
          updated_at?: string
          variable_count?: number
        }
        Relationships: []
      }
      outbound_event_ledger: {
        Row: {
          attempts: number
          body_preview: string | null
          contact_id: string | null
          correlation_id: string | null
          created_at: string
          delivered_at: string | null
          failed_at: string | null
          id: string
          idempotency_key: string
          identity_id: string | null
          kind: string
          last_error: string | null
          max_attempts: number
          next_attempt_at: string
          normalized_phone: string | null
          provider_message_id: string | null
          queued_at: string
          read_at: string | null
          request_hash: string
          sent_at: string | null
          state: string
          updated_at: string
          vault_event_id: string | null
        }
        Insert: {
          attempts?: number
          body_preview?: string | null
          contact_id?: string | null
          correlation_id?: string | null
          created_at?: string
          delivered_at?: string | null
          failed_at?: string | null
          id?: string
          idempotency_key: string
          identity_id?: string | null
          kind?: string
          last_error?: string | null
          max_attempts?: number
          next_attempt_at?: string
          normalized_phone?: string | null
          provider_message_id?: string | null
          queued_at?: string
          read_at?: string | null
          request_hash: string
          sent_at?: string | null
          state?: string
          updated_at?: string
          vault_event_id?: string | null
        }
        Update: {
          attempts?: number
          body_preview?: string | null
          contact_id?: string | null
          correlation_id?: string | null
          created_at?: string
          delivered_at?: string | null
          failed_at?: string | null
          id?: string
          idempotency_key?: string
          identity_id?: string | null
          kind?: string
          last_error?: string | null
          max_attempts?: number
          next_attempt_at?: string
          normalized_phone?: string | null
          provider_message_id?: string | null
          queued_at?: string
          read_at?: string | null
          request_hash?: string
          sent_at?: string | null
          state?: string
          updated_at?: string
          vault_event_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "outbound_event_ledger_identity_id_fkey"
            columns: ["identity_id"]
            isOneToOne: false
            referencedRelation: "contact_identity_registry"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbound_event_ledger_vault_event_id_fkey"
            columns: ["vault_event_id"]
            isOneToOne: false
            referencedRelation: "inbound_event_vault"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_ai_insights: {
        Row: {
          category: string
          confidence_score: number | null
          contact_id: string
          created_at: string
          field_name: string | null
          id: string
          linked_task_id: string | null
          proposed_value: Json | null
          reasoning: string | null
          resolution_state: string
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
          linked_task_id?: string | null
          proposed_value?: Json | null
          reasoning?: string | null
          resolution_state?: string
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
          linked_task_id?: string | null
          proposed_value?: Json | null
          reasoning?: string | null
          resolution_state?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_message?: string | null
          status?: string
        }
        Relationships: []
      }
      processing_jobs: {
        Row: {
          attempts: number
          correlation_id: string | null
          created_at: string
          dead_letter_at: string | null
          id: string
          job_type: string
          last_error: string | null
          lease_until: string | null
          leased_by: string | null
          max_attempts: number
          next_attempt_at: string
          state: string
          updated_at: string
          vault_event_id: string
        }
        Insert: {
          attempts?: number
          correlation_id?: string | null
          created_at?: string
          dead_letter_at?: string | null
          id?: string
          job_type?: string
          last_error?: string | null
          lease_until?: string | null
          leased_by?: string | null
          max_attempts?: number
          next_attempt_at?: string
          state?: string
          updated_at?: string
          vault_event_id: string
        }
        Update: {
          attempts?: number
          correlation_id?: string | null
          created_at?: string
          dead_letter_at?: string | null
          id?: string
          job_type?: string
          last_error?: string | null
          lease_until?: string | null
          leased_by?: string | null
          max_attempts?: number
          next_attempt_at?: string
          state?: string
          updated_at?: string
          vault_event_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "processing_jobs_vault_event_id_fkey"
            columns: ["vault_event_id"]
            isOneToOne: true
            referencedRelation: "inbound_event_vault"
            referencedColumns: ["id"]
          },
        ]
      }
      quarantine_events: {
        Row: {
          assigned_to: string | null
          created_at: string
          details: Json
          detected_at: string
          id: string
          reason_code: string
          resolution_notes: string | null
          resolution_status: string
          resolved_at: string | null
          severity: string
          updated_at: string
          vault_event_id: string | null
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          details?: Json
          detected_at?: string
          id?: string
          reason_code: string
          resolution_notes?: string | null
          resolution_status?: string
          resolved_at?: string | null
          severity?: string
          updated_at?: string
          vault_event_id?: string | null
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          details?: Json
          detected_at?: string
          id?: string
          reason_code?: string
          resolution_notes?: string | null
          resolution_status?: string
          resolved_at?: string | null
          severity?: string
          updated_at?: string
          vault_event_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quarantine_events_vault_event_id_fkey"
            columns: ["vault_event_id"]
            isOneToOne: true
            referencedRelation: "inbound_event_vault"
            referencedColumns: ["id"]
          },
        ]
      }
      reconciliation_findings: {
        Row: {
          action_taken: string | null
          count: number
          created_at: string
          finding_type: string
          id: string
          run_id: string
          sample_ids: Json
          severity: string
          status: string
        }
        Insert: {
          action_taken?: string | null
          count?: number
          created_at?: string
          finding_type: string
          id?: string
          run_id: string
          sample_ids?: Json
          severity?: string
          status?: string
        }
        Update: {
          action_taken?: string | null
          count?: number
          created_at?: string
          finding_type?: string
          id?: string
          run_id?: string
          sample_ids?: Json
          severity?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "reconciliation_findings_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "reconciliation_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      reconciliation_runs: {
        Row: {
          created_at: string
          error: string | null
          findings_count: number
          finished_at: string | null
          id: string
          repaired_count: number
          started_at: string
          status: string
          summary: Json
          trigger_source: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          findings_count?: number
          finished_at?: string | null
          id?: string
          repaired_count?: number
          started_at?: string
          status?: string
          summary?: Json
          trigger_source?: string
        }
        Update: {
          created_at?: string
          error?: string | null
          findings_count?: number
          finished_at?: string | null
          id?: string
          repaired_count?: number
          started_at?: string
          status?: string
          summary?: Json
          trigger_source?: string
        }
        Relationships: []
      }
      relationship_intake_answers: {
        Row: {
          answered_at: string
          asked_at: string | null
          confidence: number | null
          contact_id: string
          created_at: string
          evidence_message_id: string | null
          id: string
          is_correction: boolean
          is_current: boolean
          question_key: string
          raw_text: string | null
          skipped_by_user: boolean
          source: string
          structured_value: Json
          updated_at: string
        }
        Insert: {
          answered_at?: string
          asked_at?: string | null
          confidence?: number | null
          contact_id: string
          created_at?: string
          evidence_message_id?: string | null
          id?: string
          is_correction?: boolean
          is_current?: boolean
          question_key: string
          raw_text?: string | null
          skipped_by_user?: boolean
          source?: string
          structured_value?: Json
          updated_at?: string
        }
        Update: {
          answered_at?: string
          asked_at?: string | null
          confidence?: number | null
          contact_id?: string
          created_at?: string
          evidence_message_id?: string | null
          id?: string
          is_correction?: boolean
          is_current?: boolean
          question_key?: string
          raw_text?: string | null
          skipped_by_user?: boolean
          source?: string
          structured_value?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "relationship_intake_answers_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      relationship_intake_config: {
        Row: {
          completion_text: string
          created_at: string
          id: boolean
          intro_text: string
          updated_at: string
          voice_enabled: boolean
          voice_rules: string | null
        }
        Insert: {
          completion_text: string
          created_at?: string
          id?: boolean
          intro_text: string
          updated_at?: string
          voice_enabled?: boolean
          voice_rules?: string | null
        }
        Update: {
          completion_text?: string
          created_at?: string
          id?: boolean
          intro_text?: string
          updated_at?: string
          voice_enabled?: boolean
          voice_rules?: string | null
        }
        Relationships: []
      }
      relationship_intake_questions: {
        Row: {
          active: boolean
          created_at: string
          id: string
          is_final_question: boolean
          label: string
          order_index: number
          question_key: string
          question_text: string
          required: boolean
          skippable: boolean
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          is_final_question?: boolean
          label: string
          order_index?: number
          question_key: string
          question_text: string
          required?: boolean
          skippable?: boolean
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          is_final_question?: boolean
          label?: string
          order_index?: number
          question_key?: string
          question_text?: string
          required?: boolean
          skippable?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      relationship_intake_state: {
        Row: {
          completed_at: string | null
          completion_sent_at: string | null
          contact_id: string
          created_at: string
          current_question_key: string | null
          intro_sent_at: string | null
          last_answered_at: string | null
          pending_confirmation: Json | null
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          completion_sent_at?: string | null
          contact_id: string
          created_at?: string
          current_question_key?: string | null
          intro_sent_at?: string | null
          last_answered_at?: string | null
          pending_confirmation?: Json | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          completion_sent_at?: string | null
          contact_id?: string
          created_at?: string
          current_question_key?: string | null
          intro_sent_at?: string | null
          last_answered_at?: string | null
          pending_confirmation?: Json | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "relationship_intake_state_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: true
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      runtime_inbound_dedupe: {
        Row: {
          contact_id: string | null
          created_at: string
          hit_count: number
          inbound_message_id: string
          last_seen_at: string
          phone: string | null
          reply_text: string | null
          source: string | null
        }
        Insert: {
          contact_id?: string | null
          created_at?: string
          hit_count?: number
          inbound_message_id: string
          last_seen_at?: string
          phone?: string | null
          reply_text?: string | null
          source?: string | null
        }
        Update: {
          contact_id?: string | null
          created_at?: string
          hit_count?: number
          inbound_message_id?: string
          last_seen_at?: string
          phone?: string | null
          reply_text?: string | null
          source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "runtime_inbound_dedupe_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      tamar_admin_audit_log: {
        Row: {
          action: string
          actor: string | null
          after_value: Json | null
          area: string
          before_value: Json | null
          created_at: string
          id: string
          target_id: string | null
        }
        Insert: {
          action: string
          actor?: string | null
          after_value?: Json | null
          area: string
          before_value?: Json | null
          created_at?: string
          id?: string
          target_id?: string | null
        }
        Update: {
          action?: string
          actor?: string | null
          after_value?: Json | null
          area?: string
          before_value?: Json | null
          created_at?: string
          id?: string
          target_id?: string | null
        }
        Relationships: []
      }
      tamar_agent_versions: {
        Row: {
          activated_at: string | null
          change_summary: string | null
          created_at: string
          created_by: string | null
          id: string
          identity: Json
          safety: Json
          status: string
          updated_at: string
          version: number
        }
        Insert: {
          activated_at?: string | null
          change_summary?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          identity?: Json
          safety?: Json
          status?: string
          updated_at?: string
          version: number
        }
        Update: {
          activated_at?: string | null
          change_summary?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          identity?: Json
          safety?: Json
          status?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      tamar_behavior_settings: {
        Row: {
          confidence_auto_apply_min: number
          confidence_high_min: number
          confidence_medium_min: number
          confidence_pending_max: number
          consent_timing_rule: string
          create_contact_on_first_unknown_phone: boolean
          dating_counselor_mode_disabled: boolean
          emoji_policy: string
          gender_language_sensitivity: boolean
          handoff_confidence_threshold: number
          handoff_keywords: string[]
          handoff_on_factual_doubt: boolean
          id: number
          internal_inference_visibility: string
          memory_kinds_enabled: string[]
          memory_write_policy: string
          naturalness_level: string
          no_invention_rule: boolean
          routing_allow_autonomous_campaigns: boolean
          routing_allow_autonomous_offers: boolean
          routing_mode: string
          sales_aggressiveness: string
          sales_max_followups_per_week: number
          service_inquiry_is_lead: boolean
          therapist_mode_disabled: boolean
          tone_preset: string
          updated_at: string
          verbosity_level: string
          warmth_level: string
        }
        Insert: {
          confidence_auto_apply_min?: number
          confidence_high_min?: number
          confidence_medium_min?: number
          confidence_pending_max?: number
          consent_timing_rule?: string
          create_contact_on_first_unknown_phone?: boolean
          dating_counselor_mode_disabled?: boolean
          emoji_policy?: string
          gender_language_sensitivity?: boolean
          handoff_confidence_threshold?: number
          handoff_keywords?: string[]
          handoff_on_factual_doubt?: boolean
          id?: number
          internal_inference_visibility?: string
          memory_kinds_enabled?: string[]
          memory_write_policy?: string
          naturalness_level?: string
          no_invention_rule?: boolean
          routing_allow_autonomous_campaigns?: boolean
          routing_allow_autonomous_offers?: boolean
          routing_mode?: string
          sales_aggressiveness?: string
          sales_max_followups_per_week?: number
          service_inquiry_is_lead?: boolean
          therapist_mode_disabled?: boolean
          tone_preset?: string
          updated_at?: string
          verbosity_level?: string
          warmth_level?: string
        }
        Update: {
          confidence_auto_apply_min?: number
          confidence_high_min?: number
          confidence_medium_min?: number
          confidence_pending_max?: number
          consent_timing_rule?: string
          create_contact_on_first_unknown_phone?: boolean
          dating_counselor_mode_disabled?: boolean
          emoji_policy?: string
          gender_language_sensitivity?: boolean
          handoff_confidence_threshold?: number
          handoff_keywords?: string[]
          handoff_on_factual_doubt?: boolean
          id?: number
          internal_inference_visibility?: string
          memory_kinds_enabled?: string[]
          memory_write_policy?: string
          naturalness_level?: string
          no_invention_rule?: boolean
          routing_allow_autonomous_campaigns?: boolean
          routing_allow_autonomous_offers?: boolean
          routing_mode?: string
          sales_aggressiveness?: string
          sales_max_followups_per_week?: number
          service_inquiry_is_lead?: boolean
          therapist_mode_disabled?: boolean
          tone_preset?: string
          updated_at?: string
          verbosity_level?: string
          warmth_level?: string
        }
        Relationships: []
      }
      tamar_brain_policy: {
        Row: {
          ab_testing_enabled: boolean
          attach_transcript_to_alert: boolean
          consent_gate_enabled: boolean
          handoff_confidence_threshold: number
          id: number
          kill_switch_ab: boolean
          knowledge_grounding_required: boolean
          manager_alert_enabled: boolean
          manager_alert_template: string
          max_questions_per_message: number
          prompt_version: string
          recommendation_max_offers: number
          updated_at: string
          updated_by: string | null
          value_before_question_after_answers: number
        }
        Insert: {
          ab_testing_enabled?: boolean
          attach_transcript_to_alert?: boolean
          consent_gate_enabled?: boolean
          handoff_confidence_threshold?: number
          id?: number
          kill_switch_ab?: boolean
          knowledge_grounding_required?: boolean
          manager_alert_enabled?: boolean
          manager_alert_template?: string
          max_questions_per_message?: number
          prompt_version?: string
          recommendation_max_offers?: number
          updated_at?: string
          updated_by?: string | null
          value_before_question_after_answers?: number
        }
        Update: {
          ab_testing_enabled?: boolean
          attach_transcript_to_alert?: boolean
          consent_gate_enabled?: boolean
          handoff_confidence_threshold?: number
          id?: number
          kill_switch_ab?: boolean
          knowledge_grounding_required?: boolean
          manager_alert_enabled?: boolean
          manager_alert_template?: string
          max_questions_per_message?: number
          prompt_version?: string
          recommendation_max_offers?: number
          updated_at?: string
          updated_by?: string | null
          value_before_question_after_answers?: number
        }
        Relationships: []
      }
      tamar_copy_versions: {
        Row: {
          ab_weight: number
          body: string
          copy_key: string
          created_at: string
          id: string
          is_active: boolean
          kill_switch: boolean
          language_code: string
          notes: string | null
          template_name: string | null
          updated_at: string
          updated_by: string | null
          variant: string
          version: number
        }
        Insert: {
          ab_weight?: number
          body: string
          copy_key: string
          created_at?: string
          id?: string
          is_active?: boolean
          kill_switch?: boolean
          language_code?: string
          notes?: string | null
          template_name?: string | null
          updated_at?: string
          updated_by?: string | null
          variant?: string
          version?: number
        }
        Update: {
          ab_weight?: number
          body?: string
          copy_key?: string
          created_at?: string
          id?: string
          is_active?: boolean
          kill_switch?: boolean
          language_code?: string
          notes?: string | null
          template_name?: string | null
          updated_at?: string
          updated_by?: string | null
          variant?: string
          version?: number
        }
        Relationships: []
      }
      tamar_decision_traces: {
        Row: {
          confidence: number | null
          considered_actions: Json
          contact_id: string | null
          created_at: string
          fields_used: Json
          id: string
          knowledge_source_ids: Json
          latency_ms: number | null
          model: string | null
          offer_ids: Json
          prompt_version: string | null
          reason_codes: Json
          runtime_execution_id: string | null
          selected_action: string
          state: string
        }
        Insert: {
          confidence?: number | null
          considered_actions?: Json
          contact_id?: string | null
          created_at?: string
          fields_used?: Json
          id?: string
          knowledge_source_ids?: Json
          latency_ms?: number | null
          model?: string | null
          offer_ids?: Json
          prompt_version?: string | null
          reason_codes?: Json
          runtime_execution_id?: string | null
          selected_action: string
          state: string
        }
        Update: {
          confidence?: number | null
          considered_actions?: Json
          contact_id?: string | null
          created_at?: string
          fields_used?: Json
          id?: string
          knowledge_source_ids?: Json
          latency_ms?: number | null
          model?: string | null
          offer_ids?: Json
          prompt_version?: string | null
          reason_codes?: Json
          runtime_execution_id?: string | null
          selected_action?: string
          state?: string
        }
        Relationships: []
      }
      tamar_eval_cases: {
        Row: {
          context: Json
          created_at: string
          expect: Json
          id: string
          inbound: string
          name: string
          order_index: number
          state: string
          suite_id: string
        }
        Insert: {
          context?: Json
          created_at?: string
          expect?: Json
          id?: string
          inbound: string
          name: string
          order_index?: number
          state?: string
          suite_id: string
        }
        Update: {
          context?: Json
          created_at?: string
          expect?: Json
          id?: string
          inbound?: string
          name?: string
          order_index?: number
          state?: string
          suite_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tamar_eval_cases_suite_id_fkey"
            columns: ["suite_id"]
            isOneToOne: false
            referencedRelation: "tamar_eval_suites"
            referencedColumns: ["id"]
          },
        ]
      }
      tamar_eval_results: {
        Row: {
          actual: Json
          case_name: string
          created_at: string
          failures: Json
          id: string
          passed: boolean
          run_id: string
        }
        Insert: {
          actual?: Json
          case_name: string
          created_at?: string
          failures?: Json
          id?: string
          passed?: boolean
          run_id: string
        }
        Update: {
          actual?: Json
          case_name?: string
          created_at?: string
          failures?: Json
          id?: string
          passed?: boolean
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tamar_eval_results_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "tamar_eval_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      tamar_eval_runs: {
        Row: {
          agent_version_id: string | null
          created_at: string
          created_by: string | null
          failed: number
          finished_at: string | null
          id: string
          mode: string
          pass_rate: number
          passed: number
          suite_id: string | null
          total: number
        }
        Insert: {
          agent_version_id?: string | null
          created_at?: string
          created_by?: string | null
          failed?: number
          finished_at?: string | null
          id?: string
          mode?: string
          pass_rate?: number
          passed?: number
          suite_id?: string | null
          total?: number
        }
        Update: {
          agent_version_id?: string | null
          created_at?: string
          created_by?: string | null
          failed?: number
          finished_at?: string | null
          id?: string
          mode?: string
          pass_rate?: number
          passed?: number
          suite_id?: string | null
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "tamar_eval_runs_agent_version_id_fkey"
            columns: ["agent_version_id"]
            isOneToOne: false
            referencedRelation: "tamar_agent_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tamar_eval_runs_suite_id_fkey"
            columns: ["suite_id"]
            isOneToOne: false
            referencedRelation: "tamar_eval_suites"
            referencedColumns: ["id"]
          },
        ]
      }
      tamar_eval_suites: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      tamar_feature_flags: {
        Row: {
          allowlist: Json
          enabled: boolean
          key: string
          notes: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          allowlist?: Json
          enabled?: boolean
          key: string
          notes?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          allowlist?: Json
          enabled?: boolean
          key?: string
          notes?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      tamar_flow_options: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          label: string
          option_id: string
          order_index: number
          step_id: string
          value: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          label: string
          option_id: string
          order_index?: number
          step_id: string
          value: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          label?: string
          option_id?: string
          order_index?: number
          step_id?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "tamar_flow_options_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "tamar_flow_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      tamar_flow_steps: {
        Row: {
          agent_version_id: string
          conditions: Json
          created_at: string
          enabled: boolean
          field_key: string | null
          help_text: string | null
          id: string
          order_index: number
          presentation: string
          question_text: string
          required: boolean
          skippable: boolean
          stage: string
          step_key: string
          updated_at: string
        }
        Insert: {
          agent_version_id: string
          conditions?: Json
          created_at?: string
          enabled?: boolean
          field_key?: string | null
          help_text?: string | null
          id?: string
          order_index?: number
          presentation?: string
          question_text: string
          required?: boolean
          skippable?: boolean
          stage?: string
          step_key: string
          updated_at?: string
        }
        Update: {
          agent_version_id?: string
          conditions?: Json
          created_at?: string
          enabled?: boolean
          field_key?: string | null
          help_text?: string | null
          id?: string
          order_index?: number
          presentation?: string
          question_text?: string
          required?: boolean
          skippable?: boolean
          stage?: string
          step_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tamar_flow_steps_agent_version_id_fkey"
            columns: ["agent_version_id"]
            isOneToOne: false
            referencedRelation: "tamar_agent_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      tamar_manager_window: {
        Row: {
          id: string
          last_inbound_at: string | null
          manager_phone: string
          updated_at: string
        }
        Insert: {
          id?: string
          last_inbound_at?: string | null
          manager_phone: string
          updated_at?: string
        }
        Update: {
          id?: string
          last_inbound_at?: string | null
          manager_phone?: string
          updated_at?: string
        }
        Relationships: []
      }
      tamar_model_allowlist: {
        Row: {
          created_at: string
          label: string
          model_id: string
          notes: string | null
          tier: string
          verified_at: string | null
          verified_ok: boolean
        }
        Insert: {
          created_at?: string
          label?: string
          model_id: string
          notes?: string | null
          tier?: string
          verified_at?: string | null
          verified_ok?: boolean
        }
        Update: {
          created_at?: string
          label?: string
          model_id?: string
          notes?: string | null
          tier?: string
          verified_at?: string | null
          verified_ok?: boolean
        }
        Relationships: []
      }
      tamar_model_calls: {
        Row: {
          attempt: number
          completion_tokens: number | null
          context: string | null
          created_at: string
          error: string | null
          fallback_used: boolean
          http_status: number | null
          id: string
          latency_ms: number | null
          model_id: string
          ok: boolean
          prompt_tokens: number | null
          stage: string
        }
        Insert: {
          attempt?: number
          completion_tokens?: number | null
          context?: string | null
          created_at?: string
          error?: string | null
          fallback_used?: boolean
          http_status?: number | null
          id?: string
          latency_ms?: number | null
          model_id: string
          ok?: boolean
          prompt_tokens?: number | null
          stage: string
        }
        Update: {
          attempt?: number
          completion_tokens?: number | null
          context?: string | null
          created_at?: string
          error?: string | null
          fallback_used?: boolean
          http_status?: number | null
          id?: string
          latency_ms?: number | null
          model_id?: string
          ok?: boolean
          prompt_tokens?: number | null
          stage?: string
        }
        Relationships: []
      }
      tamar_model_registry: {
        Row: {
          created_at: string
          fallback_model: string | null
          id: string
          is_active: boolean
          max_tokens: number
          model_id: string
          notes: string | null
          params: Json
          reasoning_effort: string | null
          retries: number
          stage: string
          structured_output: boolean
          temperature: number
          timeout_ms: number
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          created_at?: string
          fallback_model?: string | null
          id?: string
          is_active?: boolean
          max_tokens?: number
          model_id: string
          notes?: string | null
          params?: Json
          reasoning_effort?: string | null
          retries?: number
          stage: string
          structured_output?: boolean
          temperature?: number
          timeout_ms?: number
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          created_at?: string
          fallback_model?: string | null
          id?: string
          is_active?: boolean
          max_tokens?: number
          model_id?: string
          notes?: string | null
          params?: Json
          reasoning_effort?: string | null
          retries?: number
          stage?: string
          structured_output?: boolean
          temperature?: number
          timeout_ms?: number
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: []
      }
      tamar_prompt_blocks: {
        Row: {
          block_key: string
          body: string
          created_at: string
          id: string
          is_active: boolean
          notes: string | null
          title: string | null
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          block_key: string
          body?: string
          created_at?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          title?: string | null
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          block_key?: string
          body?: string
          created_at?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          title?: string | null
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: []
      }
      tamar_runtime_executions: {
        Row: {
          campaign_id: string | null
          campaign_injected: boolean
          channel: string | null
          composition_version: string | null
          contact_id: string | null
          conversation_mode: string | null
          conversation_mode_reasons: Json | null
          created_at: string
          deployment_sha: string | null
          error: string | null
          fallback_reason: string | null
          id: string
          inbound_message: string | null
          latency_ms: number | null
          offer_id: string | null
          offer_intelligence_injected: boolean
          outbound_reply: string | null
          prompt_blocks_injected: Json
          raw_payload: Json | null
          runtime_mode: string
          runtime_pack_fetch_ok: boolean | null
          source: string | null
          tamar_settings_version_at: string | null
        }
        Insert: {
          campaign_id?: string | null
          campaign_injected?: boolean
          channel?: string | null
          composition_version?: string | null
          contact_id?: string | null
          conversation_mode?: string | null
          conversation_mode_reasons?: Json | null
          created_at?: string
          deployment_sha?: string | null
          error?: string | null
          fallback_reason?: string | null
          id?: string
          inbound_message?: string | null
          latency_ms?: number | null
          offer_id?: string | null
          offer_intelligence_injected?: boolean
          outbound_reply?: string | null
          prompt_blocks_injected?: Json
          raw_payload?: Json | null
          runtime_mode?: string
          runtime_pack_fetch_ok?: boolean | null
          source?: string | null
          tamar_settings_version_at?: string | null
        }
        Update: {
          campaign_id?: string | null
          campaign_injected?: boolean
          channel?: string | null
          composition_version?: string | null
          contact_id?: string | null
          conversation_mode?: string | null
          conversation_mode_reasons?: Json | null
          created_at?: string
          deployment_sha?: string | null
          error?: string | null
          fallback_reason?: string | null
          id?: string
          inbound_message?: string | null
          latency_ms?: number | null
          offer_id?: string | null
          offer_intelligence_injected?: boolean
          outbound_reply?: string | null
          prompt_blocks_injected?: Json
          raw_payload?: Json | null
          runtime_mode?: string
          runtime_pack_fetch_ok?: boolean | null
          source?: string | null
          tamar_settings_version_at?: string | null
        }
        Relationships: []
      }
      tamar_state_transitions: {
        Row: {
          actor: string
          contact_id: string | null
          created_at: string
          from_state: string | null
          id: string
          reason_codes: Json
          runtime_execution_id: string | null
          to_state: string
          trigger: string
        }
        Insert: {
          actor?: string
          contact_id?: string | null
          created_at?: string
          from_state?: string | null
          id?: string
          reason_codes?: Json
          runtime_execution_id?: string | null
          to_state: string
          trigger: string
        }
        Update: {
          actor?: string
          contact_id?: string | null
          created_at?: string
          from_state?: string | null
          id?: string
          reason_codes?: Json
          runtime_execution_id?: string | null
          to_state?: string
          trigger?: string
        }
        Relationships: [
          {
            foreignKeyName: "tamar_state_transitions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
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
          resolution_state: string
          source_kind: string | null
          source_ref_id: string | null
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
          resolution_state?: string
          source_kind?: string | null
          source_ref_id?: string | null
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
          resolution_state?: string
          source_kind?: string | null
          source_ref_id?: string | null
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
      voice_transcripts: {
        Row: {
          confidence: number | null
          contact_id: string | null
          created_at: string
          duration_seconds: number | null
          error: string | null
          id: string
          language: string | null
          media_id: string | null
          mime_type: string | null
          model: string | null
          provider: string | null
          size_bytes: number | null
          status: string
          transcript: string | null
          updated_at: string
          wa_message_id: string
        }
        Insert: {
          confidence?: number | null
          contact_id?: string | null
          created_at?: string
          duration_seconds?: number | null
          error?: string | null
          id?: string
          language?: string | null
          media_id?: string | null
          mime_type?: string | null
          model?: string | null
          provider?: string | null
          size_bytes?: number | null
          status?: string
          transcript?: string | null
          updated_at?: string
          wa_message_id: string
        }
        Update: {
          confidence?: number | null
          contact_id?: string | null
          created_at?: string
          duration_seconds?: number | null
          error?: string | null
          id?: string
          language?: string | null
          media_id?: string | null
          mime_type?: string | null
          model?: string | null
          provider?: string | null
          size_bytes?: number | null
          status?: string
          transcript?: string | null
          updated_at?: string
          wa_message_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "voice_transcripts_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
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
      zero_loss_audit_log: {
        Row: {
          action: string
          actor_label: string | null
          actor_user_id: string | null
          created_at: string
          details: Json
          id: string
          target_id: string | null
          target_kind: string | null
        }
        Insert: {
          action: string
          actor_label?: string | null
          actor_user_id?: string | null
          created_at?: string
          details?: Json
          id?: string
          target_id?: string | null
          target_kind?: string | null
        }
        Update: {
          action?: string
          actor_label?: string | null
          actor_user_id?: string | null
          created_at?: string
          details?: Json
          id?: string
          target_id?: string | null
          target_kind?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      offers_public: {
        Row: {
          category: Database["public"]["Enums"]["offer_category"] | null
          created_at: string | null
          currency: string | null
          description: string | null
          event_date: string | null
          event_end_date: string | null
          flights_included: boolean | null
          id: string | null
          nights: number | null
          offer_url: string | null
          price: number | null
          status: Database["public"]["Enums"]["offer_status"] | null
          title: string | null
          updated_at: string | null
        }
        Insert: {
          category?: Database["public"]["Enums"]["offer_category"] | null
          created_at?: string | null
          currency?: string | null
          description?: string | null
          event_date?: string | null
          event_end_date?: string | null
          flights_included?: boolean | null
          id?: string | null
          nights?: number | null
          offer_url?: string | null
          price?: number | null
          status?: Database["public"]["Enums"]["offer_status"] | null
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          category?: Database["public"]["Enums"]["offer_category"] | null
          created_at?: string | null
          currency?: string | null
          description?: string | null
          event_date?: string | null
          event_end_date?: string | null
          flights_included?: boolean | null
          id?: string | null
          nights?: number | null
          offer_url?: string | null
          price?: number | null
          status?: Database["public"]["Enums"]["offer_status"] | null
          title?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      offers_sellable: {
        Row: {
          ai_summary: string | null
          base_price_per_person: number | null
          category: Database["public"]["Enums"]["offer_category"] | null
          couple_price: number | null
          created_at: string | null
          currency: string | null
          description: string | null
          escalation_boundary: Json | null
          event_date: string | null
          event_end_date: string | null
          extraction_raw: Json | null
          faq_bundle: Json | null
          flights_included: boolean | null
          grounded_facts: Json | null
          id: string | null
          included: Json | null
          ingestion_status: string | null
          itinerary_summary: string | null
          last_ingested_at: string | null
          matching_tags: string[] | null
          needs_date_review: boolean | null
          nights: number | null
          not_included: Json | null
          objection_notes: Json | null
          offer_url: string | null
          price: number | null
          price_basis: string | null
          pricing_status: string | null
          rooming_policy: string | null
          sales_angle: string | null
          single_supplement: number | null
          status: Database["public"]["Enums"]["offer_status"] | null
          target_interests: string[] | null
          target_max_age: number | null
          target_min_age: number | null
          target_region: string | null
          target_spending_profile:
            | Database["public"]["Enums"]["spending_profile"]
            | null
          title: string | null
          updated_at: string | null
        }
        Insert: {
          ai_summary?: string | null
          base_price_per_person?: number | null
          category?: Database["public"]["Enums"]["offer_category"] | null
          couple_price?: number | null
          created_at?: string | null
          currency?: string | null
          description?: string | null
          escalation_boundary?: Json | null
          event_date?: string | null
          event_end_date?: string | null
          extraction_raw?: Json | null
          faq_bundle?: Json | null
          flights_included?: boolean | null
          grounded_facts?: Json | null
          id?: string | null
          included?: Json | null
          ingestion_status?: string | null
          itinerary_summary?: string | null
          last_ingested_at?: string | null
          matching_tags?: string[] | null
          needs_date_review?: boolean | null
          nights?: number | null
          not_included?: Json | null
          objection_notes?: Json | null
          offer_url?: string | null
          price?: number | null
          price_basis?: string | null
          pricing_status?: string | null
          rooming_policy?: string | null
          sales_angle?: string | null
          single_supplement?: number | null
          status?: Database["public"]["Enums"]["offer_status"] | null
          target_interests?: string[] | null
          target_max_age?: number | null
          target_min_age?: number | null
          target_region?: string | null
          target_spending_profile?:
            | Database["public"]["Enums"]["spending_profile"]
            | null
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          ai_summary?: string | null
          base_price_per_person?: number | null
          category?: Database["public"]["Enums"]["offer_category"] | null
          couple_price?: number | null
          created_at?: string | null
          currency?: string | null
          description?: string | null
          escalation_boundary?: Json | null
          event_date?: string | null
          event_end_date?: string | null
          extraction_raw?: Json | null
          faq_bundle?: Json | null
          flights_included?: boolean | null
          grounded_facts?: Json | null
          id?: string | null
          included?: Json | null
          ingestion_status?: string | null
          itinerary_summary?: string | null
          last_ingested_at?: string | null
          matching_tags?: string[] | null
          needs_date_review?: boolean | null
          nights?: number | null
          not_included?: Json | null
          objection_notes?: Json | null
          offer_url?: string | null
          price?: number | null
          price_basis?: string | null
          pricing_status?: string | null
          rooming_policy?: string | null
          sales_angle?: string | null
          single_supplement?: number | null
          status?: Database["public"]["Enums"]["offer_status"] | null
          target_interests?: string[] | null
          target_max_age?: number | null
          target_min_age?: number | null
          target_region?: string | null
          target_spending_profile?:
            | Database["public"]["Enums"]["spending_profile"]
            | null
          title?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
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
      zl_claim_jobs: {
        Args: { p_lease_seconds: number; p_limit: number; p_worker: string }
        Returns: {
          attempts: number
          correlation_id: string
          job_id: string
          max_attempts: number
          vault_event_id: string
        }[]
      }
      zl_finish_job: {
        Args: {
          p_backoff_seconds: number
          p_contact_id: string
          p_error: string
          p_job_id: string
          p_success: boolean
        }
        Returns: undefined
      }
      zl_ingest_event: {
        Args: {
          p_correlation_id: string
          p_dedupe_key: string
          p_event_type: string
          p_normalized_phone: string
          p_payload_sha256: string
          p_phone_hash: string
          p_provider: string
          p_provider_event_id: string
          p_raw_payload: Json
        }
        Returns: {
          correlation_id: string
          duplicate: boolean
          vault_id: string
        }[]
      }
      zl_register_identity: {
        Args: {
          p_contact_id: string
          p_normalized_value: string
          p_source: string
          p_value_hash: string
        }
        Returns: string
      }
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
      tamar_conversation_state:
        | "consent_pending"
        | "consented"
        | "opted_out"
        | "intake_active"
        | "value_delivery"
        | "offer_recommended"
        | "human_handoff_queued"
        | "human_owned"
        | "paused"
        | "closed"
        | "new_inbound"
        | "consent_asked"
        | "recommendation_ready"
        | "value_delivered"
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
      tamar_conversation_state: [
        "consent_pending",
        "consented",
        "opted_out",
        "intake_active",
        "value_delivery",
        "offer_recommended",
        "human_handoff_queued",
        "human_owned",
        "paused",
        "closed",
        "new_inbound",
        "consent_asked",
        "recommendation_ready",
        "value_delivered",
      ],
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
