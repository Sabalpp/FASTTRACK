import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "@/lib/server-auth";
import {
  SCHEDULING_SETTINGS_SINGLETON_ID,
  SchedulingSettingsValidationError,
  schedulingSettingsFromRow,
  schedulingSettingsToRow,
  type SchedulingSettings,
  type SchedulingSettingsRow
} from "@/lib/scheduling-settings";

const SCHEDULING_SETTINGS_COLUMNS = [
  "id",
  "time_zone",
  "default_arrival_window_minutes",
  "business_day_start_time",
  "business_day_end_time",
  "scheduling_increment_minutes",
  "updated_at",
  "updated_by"
].join(",");

export async function loadSchedulingSettings(supabase: SupabaseClient): Promise<SchedulingSettings> {
  const { data, error } = await supabase
    .from("business_scheduling_settings")
    .select(SCHEDULING_SETTINGS_COLUMNS)
    .eq("id", SCHEDULING_SETTINGS_SINGLETON_ID)
    .maybeSingle();

  if (error) throw new HttpError(503, "Scheduling settings could not be loaded.");

  try {
    return schedulingSettingsFromRow(data as unknown as SchedulingSettingsRow | null);
  } catch (error) {
    if (error instanceof SchedulingSettingsValidationError) {
      throw new HttpError(503, "The saved scheduling settings are invalid.");
    }
    throw error;
  }
}

export async function saveSchedulingSettings(
  supabase: SupabaseClient,
  settings: SchedulingSettings,
  updatedBy: string
): Promise<SchedulingSettings> {
  const { data, error } = await supabase
    .from("business_scheduling_settings")
    .upsert(schedulingSettingsToRow(settings, updatedBy), { onConflict: "id" })
    .select(SCHEDULING_SETTINGS_COLUMNS)
    .single();

  if (error || !data) throw new HttpError(503, "Scheduling settings could not be saved.");

  try {
    return schedulingSettingsFromRow(data as unknown as SchedulingSettingsRow);
  } catch (error) {
    if (error instanceof SchedulingSettingsValidationError) {
      throw new HttpError(503, "The saved scheduling settings are invalid.");
    }
    throw error;
  }
}
