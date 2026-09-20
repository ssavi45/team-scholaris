export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

import type { Task, TaskRow, TaskSummary } from '../features/tasks/task-types'

export type Database = {
  public: {
    Tables: {
      paper_files: {
        Row: {
          content: string
          id: string
          kind: string
          path: string
          project_id: string
          size_bytes: number
          storage_path: string | null
          updated_at: string
          version: number
        }
        Insert: {
          content?: string
          id?: string
          kind?: string
          path: string
          project_id: string
          size_bytes?: number
          storage_path?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          content?: string
          id?: string
          kind?: string
          path?: string
          project_id?: string
          size_bytes?: number
          storage_path?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "paper_files_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "paper_workspaces"
            referencedColumns: ["project_id"]
          },
        ]
      }
      paper_workspaces: {
        Row: {
          created_at: string
          main_file: string
          project_id: string
          revision: number
        }
        Insert: {
          created_at?: string
          main_file?: string
          project_id: string
          revision?: number
        }
        Update: {
          created_at?: string
          main_file?: string
          project_id?: string
          revision?: number
        }
        Relationships: [
          {
            foreignKeyName: "paper_workspaces_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          id: string
          name?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      project_files: {
        Row: {
          created_at: string
          id: string
          mime_type: string
          name: string
          project_id: string
          size_bytes: number
          storage_path: string
          updated_at: string
          uploaded_by: string
        }
        Insert: {
          created_at?: string
          id?: string
          mime_type?: string
          name: string
          project_id: string
          size_bytes: number
          storage_path: string
          updated_at?: string
          uploaded_by: string
        }
        Update: {
          created_at?: string
          id?: string
          mime_type?: string
          name?: string
          project_id?: string
          size_bytes?: number
          storage_path?: string
          updated_at?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_files_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_files_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      project_invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          access_level: string
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          project_id: string
          revoked_at: string | null
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          access_level: string
          created_at?: string
          email: string
          expires_at: string
          id?: string
          invited_by: string
          project_id: string
          revoked_at?: string | null
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          access_level?: string
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          project_id?: string
          revoked_at?: string | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_invitations_accepted_by_fkey"
            columns: ["accepted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_invitations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_members: {
        Row: {
          access_level: string
          display_role: string | null
          id: string
          joined_at: string
          project_id: string
          user_id: string
        }
        Insert: {
          access_level: string
          display_role?: string | null
          id?: string
          joined_at?: string
          project_id: string
          user_id: string
        }
        Update: {
          access_level?: string
          display_role?: string | null
          id?: string
          joined_at?: string
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      project_messages: {
        Row: {
          channel: string
          content: string
          created_at: string
          id: string
          project_id: string
          sender_id: string
          updated_at: string
        }
        Insert: {
          channel?: string
          content: string
          created_at?: string
          id?: string
          project_id: string
          sender_id: string
          updated_at?: string
        }
        Update: {
          channel?: string
          content?: string
          created_at?: string
          id?: string
          project_id?: string
          sender_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_messages_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          created_at: string
          deleted_at: string | null
          description: string
          id: string
          name: string
          owner_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          description?: string
          id?: string
          name: string
          owner_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          description?: string
          id?: string
          name?: string
          owner_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_project_tasks: { Args: { p_project_id: string }; Returns: Task[] }
      get_project_task_summary: { Args: { p_project_id: string; p_today: string }; Returns: TaskSummary[] }
      save_project_task: {
        Args: { p_project_id: string; p_task_id: string; p_revision: number; p_title: string; p_description: string; p_assignee_id: string | null; p_status: string; p_priority: string; p_due_date: string | null }
        Returns: TaskRow
      }
      delete_project_task: { Args: { p_project_id: string; p_task_id: string; p_revision: number }; Returns: undefined }
      accept_project_invitation: {
        Args: { p_invitation_id?: string; p_token?: string }
        Returns: string
      }
      apply_paper_manifest: {
        Args: {
          p_entries: Json
          p_main_file: string
          p_project_id: string
          p_revision: number
        }
        Returns: undefined
      }
      can_access_project: { Args: { project_id: string }; Returns: boolean }
      can_manage_project_file: {
        Args: { p_project_id: string; p_uploaded_by: string }
        Returns: boolean
      }
      can_upload_project_file: {
        Args: { p_project_id: string }
        Returns: boolean
      }
      create_paper_file: {
        Args: { p_path: string; p_project_id: string }
        Returns: {
          content: string
          id: string
          kind: string
          path: string
          project_id: string
          size_bytes: number
          storage_path: string | null
          updated_at: string
          version: number
        }[]
        SetofOptions: {
          from: "*"
          to: "paper_files"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      create_project: {
        Args: { project_description?: string; project_name: string }
        Returns: {
          created_at: string
          deleted_at: string | null
          description: string
          id: string
          name: string
          owner_id: string
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "projects"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      create_project_invitation: {
        Args: { p_access_level: string; p_email: string; p_project_id: string }
        Returns: {
          expires_at: string
          invitation_id: string
          invitation_token: string
          project_name: string
          recipient_email: string
        }[]
      }
      get_project_files: {
        Args: { p_project_id: string }
        Returns: {
          created_at: string
          id: string
          mime_type: string
          name: string
          project_id: string
          size_bytes: number
          storage_path: string
          updated_at: string
          uploaded_by: string
          uploader_name: string
        }[]
      }
      get_project_messages: {
        Args: { p_channel?: string; p_limit?: number; p_project_id: string }
        Returns: {
          channel: string
          content: string
          created_at: string
          id: string
          project_id: string
          sender_avatar: string
          sender_id: string
          sender_name: string
          sender_role: string
          updated_at: string
        }[]
      }
      get_project_team: {
        Args: { p_project_id: string }
        Returns: {
          access_level: string
          display_role: string
          name: string
          user_id: string
        }[]
      }
      initialize_paper: { Args: { p_project_id: string }; Returns: undefined }
      invite_expiry_days: { Args: never; Returns: number }
      leave_project: { Args: { p_project_id: string }; Returns: undefined }
      remove_project_member: {
        Args: { p_project_id: string; p_user_id: string; p_expected_access_level: string }
        Returns: undefined
      }
      update_project_member: {
        Args: {
          p_project_id: string
          p_user_id: string
          p_access_level: string
          p_display_role: string | null
          p_expected_access_level: string
          p_expected_display_role: string | null
        }
        Returns: undefined
      }
      list_project_invitations: {
        Args: { p_project_id?: string; p_token?: string }
        Returns: {
          accepted_at: string
          access_level: string
          email: string
          expires_at: string
          id: string
          project_id: string
          project_name: string
          revoked_at: string
        }[]
      }
      max_owned_projects: { Args: never; Returns: number }
      paper_storage_allowed: {
        Args: { p_name: string; p_write: boolean }
        Returns: boolean
      }
      project_file_storage_allowed: {
        Args: { p_name: string; p_write: boolean }
        Returns: boolean
      }
      require_paper_editor: {
        Args: { p_project_id: string }
        Returns: undefined
      }
      revoke_project_invitation: {
        Args: { p_invitation_id: string }
        Returns: undefined
      }
      save_paper_file: {
        Args: {
          p_content: string
          p_expected_version: number
          p_file_id: string
        }
        Returns: {
          content: string
          id: string
          kind: string
          path: string
          project_id: string
          size_bytes: number
          storage_path: string | null
          updated_at: string
          version: number
        }[]
        SetofOptions: {
          from: "*"
          to: "paper_files"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      verified_caller_email: { Args: never; Returns: string }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const

