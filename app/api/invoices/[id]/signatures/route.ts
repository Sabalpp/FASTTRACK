import { NextRequest } from "next/server";
import { deleteSignatureResponse, getSignatureResponse, postSignatureResponse } from "@/lib/signature-server";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  return getSignatureResponse(request, { type: "invoice", id });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  return postSignatureResponse(request, { type: "invoice", id });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  return deleteSignatureResponse(request, { type: "invoice", id });
}
