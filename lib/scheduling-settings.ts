export const SCHEDULING_SETTINGS_SINGLETON_ID = 1;
export const SCHEDULING_INCREMENT_OPTIONS = [5, 10, 15, 30, 60] as const;

export type SchedulingIncrementMinutes = (typeof SCHEDULING_INCREMENT_OPTIONS)[number];

export type SchedulingSettings = {
  timeZone: string;
  defaultArrivalWindowMinutes: number;
  businessDayStartTime: string;
  businessDayEndTime: string;
  schedulingIncrementMinutes: SchedulingIncrementMinutes;
  updatedAt?: string;
};

export type SchedulingSettingsPatch = Partial<Pick<
  SchedulingSettings,
  | "defaultArrivalWindowMinutes"
  | "businessDayStartTime"
  | "businessDayEndTime"
  | "schedulingIncrementMinutes"
>>;

export type SchedulingSettingsRow = {
  id: number;
  time_zone: string;
  default_arrival_window_minutes: number;
  business_day_start_time: string;
  business_day_end_time: string;
  scheduling_increment_minutes: number;
  updated_at: string;
  updated_by?: string | null;
};

export const DEFAULT_SCHEDULING_SETTINGS: Readonly<SchedulingSettings> = Object.freeze({
  timeZone: "America/New_York",
  defaultArrivalWindowMinutes: 180,
  businessDayStartTime: "08:00",
  businessDayEndTime: "17:00",
  schedulingIncrementMinutes: 15
});

const PATCH_KEYS = new Set([
  "defaultArrivalWindowMinutes",
  "businessDayStartTime",
  "businessDayEndTime",
  "schedulingIncrementMinutes"
]);

export class SchedulingSettingsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchedulingSettingsValidationError";
  }
}

export function validateSchedulingSettings(input: unknown): SchedulingSettings {
  if (!isRecord(input)) throw new SchedulingSettingsValidationError("Scheduling settings must be an object.");

  const timeZone = readTimeZone(input.timeZone);
  const schedulingIncrementMinutes = readIncrement(input.schedulingIncrementMinutes);
  const defaultArrivalWindowMinutes = readArrivalWindowMinutes(input.defaultArrivalWindowMinutes);
  const businessDayStartTime = readClockTime(input.businessDayStartTime, "Business-day start time");
  const businessDayEndTime = readClockTime(input.businessDayEndTime, "Business-day end time");
  const startMinutes = clockMinutes(businessDayStartTime);
  const endMinutes = clockMinutes(businessDayEndTime);

  if (endMinutes <= startMinutes) {
    throw new SchedulingSettingsValidationError("Business-day end time must be later than its start time.");
  }
  if (defaultArrivalWindowMinutes % schedulingIncrementMinutes !== 0) {
    throw new SchedulingSettingsValidationError("Default arrival-window duration must be divisible by the scheduling increment.");
  }

  const updatedAt = readOptionalTimestamp(input.updatedAt);
  return {
    timeZone,
    defaultArrivalWindowMinutes,
    businessDayStartTime,
    businessDayEndTime,
    schedulingIncrementMinutes,
    ...(updatedAt ? { updatedAt } : {})
  };
}

export function applySchedulingSettingsPatch(
  current: SchedulingSettings,
  patch: unknown
): SchedulingSettings {
  if (!isRecord(patch)) throw new SchedulingSettingsValidationError("Scheduling settings update must be an object.");
  const unknownKey = Object.keys(patch).find((key) => !PATCH_KEYS.has(key));
  if (unknownKey) throw new SchedulingSettingsValidationError(`Unknown scheduling setting: ${unknownKey}.`);

  return validateSchedulingSettings({
    // Appointment copy and legacy server fallbacks still use Eastern time.
    // Keep the stored zone readable/validated but not owner-editable until
    // every notification path consumes this shared setting.
    timeZone: current.timeZone,
    defaultArrivalWindowMinutes: ownValueOrCurrent(
      patch,
      "defaultArrivalWindowMinutes",
      current.defaultArrivalWindowMinutes
    ),
    businessDayStartTime: ownValueOrCurrent(patch, "businessDayStartTime", current.businessDayStartTime),
    businessDayEndTime: ownValueOrCurrent(patch, "businessDayEndTime", current.businessDayEndTime),
    schedulingIncrementMinutes: ownValueOrCurrent(
      patch,
      "schedulingIncrementMinutes",
      current.schedulingIncrementMinutes
    ),
    updatedAt: current.updatedAt
  });
}

export function schedulingSettingsFromRow(row: SchedulingSettingsRow | null | undefined): SchedulingSettings {
  if (!row) return { ...DEFAULT_SCHEDULING_SETTINGS };
  if (Number(row.id) !== SCHEDULING_SETTINGS_SINGLETON_ID) {
    throw new SchedulingSettingsValidationError("The scheduling settings record is invalid.");
  }

  return validateSchedulingSettings({
    timeZone: row.time_zone,
    defaultArrivalWindowMinutes: row.default_arrival_window_minutes,
    businessDayStartTime: databaseClockTime(row.business_day_start_time),
    businessDayEndTime: databaseClockTime(row.business_day_end_time),
    schedulingIncrementMinutes: row.scheduling_increment_minutes,
    updatedAt: row.updated_at
  });
}

export function schedulingSettingsToRow(settings: SchedulingSettings, updatedBy: string) {
  const validated = validateSchedulingSettings(settings);
  return {
    id: SCHEDULING_SETTINGS_SINGLETON_ID,
    time_zone: validated.timeZone,
    default_arrival_window_minutes: validated.defaultArrivalWindowMinutes,
    business_day_start_time: validated.businessDayStartTime,
    business_day_end_time: validated.businessDayEndTime,
    scheduling_increment_minutes: validated.schedulingIncrementMinutes,
    updated_by: updatedBy
  };
}

function readTimeZone(value: unknown): string {
  if (typeof value !== "string") throw new SchedulingSettingsValidationError("Choose a valid business time zone.");
  const timeZone = value.trim();
  if (!timeZone || timeZone.length > 100 || !/^[A-Za-z0-9_+./-]+$/.test(timeZone)) {
    throw new SchedulingSettingsValidationError("Choose a valid business time zone.");
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date(0));
  } catch {
    throw new SchedulingSettingsValidationError("Choose a valid business time zone.");
  }
  return timeZone;
}

function readIncrement(value: unknown): SchedulingIncrementMinutes {
  if (typeof value !== "number" || !SCHEDULING_INCREMENT_OPTIONS.some((option) => option === value)) {
    throw new SchedulingSettingsValidationError("Scheduling increment must be 5, 10, 15, 30, or 60 minutes.");
  }
  return value as SchedulingIncrementMinutes;
}

function readArrivalWindowMinutes(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 15 || value > 720) {
    throw new SchedulingSettingsValidationError("Default arrival-window duration must be an integer from 15 to 720 minutes.");
  }
  return value;
}

function readClockTime(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new SchedulingSettingsValidationError(`${label} must use 24-hour HH:mm format.`);
  }
  return value;
}

function readOptionalTimestamp(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new SchedulingSettingsValidationError("Scheduling settings update time is invalid.");
  }
  return value;
}

function databaseClockTime(value: string): string {
  const match = /^(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(String(value));
  if (!match) throw new SchedulingSettingsValidationError("The saved business-day time is invalid.");
  return match[1];
}

function clockMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ownValueOrCurrent(
  patch: Record<string, unknown>,
  key: string,
  currentValue: unknown
): unknown {
  return Object.prototype.hasOwnProperty.call(patch, key) ? patch[key] : currentValue;
}
