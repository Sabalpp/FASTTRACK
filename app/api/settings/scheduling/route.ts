import { NextRequest, NextResponse } from "next/server";
import {
  SchedulingSettingsValidationError,
  applySchedulingSettingsPatch
} from "@/lib/scheduling-settings";
import {
  loadSchedulingSettings,
  saveSchedulingSettings
} from "@/lib/scheduling-settings-server";
import { HttpError, requireServerActor, routeErrorResponse } from "@/lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "cache-control": "no-store, max-age=0" };

export async function GET(request: NextRequest) {
  try {
    const actor = await requireServerActor(request);
    const settings = await loadSchedulingSettings(actor.supabase);
    return NextResponse.json({ settings }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const actor = await requireServerActor(request);
    if (actor.user.role !== "owner") {
      throw new HttpError(403, "Only an owner can change scheduling settings.");
    }

    let patch: unknown;
    try {
      patch = await request.json();
    } catch {
      throw new HttpError(400, "Scheduling settings update must be valid JSON.");
    }

    const current = await loadSchedulingSettings(actor.supabase);
    let completeSettings;
    try {
      completeSettings = applySchedulingSettingsPatch(current, patch);
    } catch (error) {
      if (error instanceof SchedulingSettingsValidationError) {
        throw new HttpError(400, error.message);
      }
      throw error;
    }

    const settings = await saveSchedulingSettings(actor.supabase, completeSettings, actor.user.id);
    return NextResponse.json({ settings }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
