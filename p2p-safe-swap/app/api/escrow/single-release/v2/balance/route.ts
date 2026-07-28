import { NextRequest, NextResponse } from "next/server";
import { trustlessWork, TrustlessWorkApiError } from "@/lib/trustless-work";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseNumeric(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value.toFixed(7).replace(/\.?0+$/, "");
  }

  if (typeof value === "string" && /^\d+(?:\.\d{1,7})?$/.test(value)) {
    return value;
  }

  return null;
}

function normalizeBalance(data: unknown, contractId: string): string | null {
  const numeric = parseNumeric(data);
  if (numeric !== null) return numeric;

  if (Array.isArray(data)) {
    if (data.length === 0) return null;
    for (const item of data) {
      const parsed = normalizeBalance(item, contractId);
      if (parsed !== null) return parsed;
    }
    return null;
  }

  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;

    if (Object.prototype.hasOwnProperty.call(record, contractId)) {
      return normalizeBalance(record[contractId], contractId);
    }

    if (Object.prototype.hasOwnProperty.call(record, "balance")) {
      return parseNumeric(record["balance"]);
    }

    const values = Object.values(record);
    if (values.length === 1) {
      return normalizeBalance(values[0], contractId);
    }

    for (const value of values) {
      if (value && typeof value === "object" && "balance" in (value as Record<string, unknown>)) {
        return parseNumeric((value as Record<string, unknown>).balance);
      }
    }
  }

  return null;
}

function getErrorResponse(error: unknown) {
  if (error instanceof TrustlessWorkApiError) {
    return NextResponse.json({ error: error.details }, { status: error.status });
  }

  const message = error instanceof Error ? error.message : "Unable to fetch escrow balance";
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function GET(request: NextRequest) {
  const contractId = request.nextUrl.searchParams.get("contractId");

  if (!isNonEmptyString(contractId)) {
    return NextResponse.json(
      { error: "contractId is required" },
      { status: 400 }
    );
  }

  try {
    const response = await trustlessWork.helper.getMultipleEscrowBalance([contractId]);
    const balance = normalizeBalance(response, contractId);

    if (balance === null) {
      return NextResponse.json(
        { error: "Could not determine escrow balance" },
        { status: 502 }
      );
    }

    return NextResponse.json({ balance });
  } catch (error) {
    return getErrorResponse(error);
  }
}
