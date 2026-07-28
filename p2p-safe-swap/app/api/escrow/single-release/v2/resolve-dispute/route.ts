import { NextRequest, NextResponse } from "next/server";
import {
  trustlessWork,
  TrustlessWorkApiError,
  type ResolveDisputeRequest,
} from "@/lib/trustless-work";

interface ResolveDisputeRouteBody {
  contractId?: unknown;
  disputeResolver?: unknown;
  distributions?: unknown;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

const DECIMAL_AMOUNT = /^\d+(?:\.\d{1,7})?$/;

function isPositiveAmount(value: unknown): value is string | number {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0;
  }

  return typeof value === "string" && DECIMAL_AMOUNT.test(value) && Number(value) > 0;
}

function isValidDistributionItem(value: unknown): value is {
  address: string;
  amount: string | number;
} {
  if (!value || typeof value !== "object") return false;

  const item = value as Record<string, unknown>;
  return isNonEmptyString(item.address) && isPositiveAmount(item.amount);
}

function getErrorResponse(error: unknown) {
  if (error instanceof TrustlessWorkApiError) {
    return NextResponse.json({ error: error.details }, { status: error.status });
  }

  const message = error instanceof Error ? error.message : "Unable to resolve dispute";
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function POST(request: NextRequest) {
  let body: ResolveDisputeRouteBody;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  if (!isNonEmptyString(body.contractId) || !isNonEmptyString(body.disputeResolver)) {
    return NextResponse.json(
      { error: "contractId and disputeResolver are required" },
      { status: 400 }
    );
  }

  if (!Array.isArray(body.distributions) || body.distributions.length === 0) {
    return NextResponse.json(
      { error: "distributions must be a non-empty array" },
      { status: 400 }
    );
  }

  const distributions = body.distributions;
  if (!distributions.every(isValidDistributionItem)) {
    return NextResponse.json(
      { error: "Each distribution must include an address and a positive amount" },
      { status: 400 }
    );
  }

  const configuredResolver = process.env.DISPUTE_RESOLVER_ADDRESS;
  if (!configuredResolver) {
    return NextResponse.json(
      { error: "DISPUTE_RESOLVER_ADDRESS is not set" },
      { status: 500 }
    );
  }

  if (body.disputeResolver.trim() !== configuredResolver) {
    return NextResponse.json(
      { error: "Only an account with the disputeResolver role can resolve this dispute" },
      { status: 403 }
    );
  }

  const normalizedAddresses = distributions.map(({ address }) => address.trim());
  if (new Set(normalizedAddresses).size !== normalizedAddresses.length) {
    return NextResponse.json(
      { error: "Each distribution address must be unique" },
      { status: 400 }
    );
  }

  try {
    const data = await trustlessWork.escrow.resolveDispute({
      contractId: body.contractId,
      disputeResolver: body.disputeResolver,
      distributions: distributions.map((item) => ({
        address: item.address.trim(),
        amount: Number(item.amount),
      })),
    } as ResolveDisputeRequest);

    const unsignedXdr = data.unsignedXdr ?? data.unsignedTransaction;
    if (!unsignedXdr) {
      return NextResponse.json(
        { error: "Resolve dispute transaction was not returned by the escrow service" },
        { status: 502 }
      );
    }

    return NextResponse.json({ unsignedXdr });
  } catch (error) {
    return getErrorResponse(error);
  }
}
