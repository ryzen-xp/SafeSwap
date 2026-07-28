export type DisputeResolutionStatus =
  | "idle"
  | "loading-balance"
  | "requesting-signature"
  | "submitting"
  | "resolved"
  | "failed";

export interface DisputeDistribution {
  address: string;
  amount: string;
}

export interface ResolveDisputeInput {
  contractId: string;
  disputeResolver: string;
  distributions: DisputeDistribution[];
}

export interface DisputeResolutionResult {
  balance: string;
  distributions: DisputeDistribution[];
  transaction: unknown;
}

export type SignDisputeResolutionTransaction = (
  unsignedXdr: string
) => Promise<string>;

export class DisputeResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DisputeResolutionError";
  }
}

const DECIMAL_AMOUNT = /^\d+(?:\.\d{1,7})?$/;

interface ErrorResponse {
  error?: string;
}

async function readError(response: Response): Promise<string> {
  const fallback = `Request failed (${response.status})`;

  try {
    const body = (await response.json()) as ErrorResponse;
    return body.error || fallback;
  } catch {
    return fallback;
  }
}

function readBalanceValue(value: unknown): string | null {
  if (typeof value === "string" && DECIMAL_AMOUNT.test(value)) return value;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value.toFixed(7).replace(/\.?0+$/, "");
  }
  return null;
}

function extractBalance(response: unknown, contractId: string): string | null {
  const direct = readBalanceValue(response);
  if (direct !== null) return direct;

  if (Array.isArray(response)) {
    const matchingEntry = response.find((entry) => {
      if (!entry || typeof entry !== "object") return false;
      const item = entry as Record<string, unknown>;
      return item.address === contractId || item.contractId === contractId;
    });

    return extractBalance(matchingEntry ?? response[0], contractId);
  }

  if (!response || typeof response !== "object") return null;

  const object = response as Record<string, unknown>;
  const balance = readBalanceValue(object.balance);
  if (balance !== null) return balance;

  const keyedBalance = readBalanceValue(object[contractId]);
  if (keyedBalance !== null) return keyedBalance;

  for (const key of ["balances", "data", "result", "escrows"]) {
    if (object[key] !== undefined) {
      const nested = extractBalance(object[key], contractId);
      if (nested !== null) return nested;
    }
  }

  return null;
}

function decimalParts(value: string) {
  if (!DECIMAL_AMOUNT.test(value)) {
    throw new DisputeResolutionError(
      "Distribution amounts must be decimals with at most 7 decimal places"
    );
  }

  const [whole, fraction = ""] = value.split(".");
  return { whole, fraction };
}

function toScaledUnits(value: string, scale: number): bigint {
  const { whole, fraction } = decimalParts(value);
  return BigInt(`${whole}${fraction.padEnd(scale, "0")}`);
}

export function distributionsMatchBalance(
  distributions: DisputeDistribution[],
  balance: string
): boolean {
  if (distributions.length === 0) return false;

  const balanceParts = decimalParts(balance);
  const distributionParts = distributions.map(({ amount }) => decimalParts(amount));
  const scale = Math.max(
    balanceParts.fraction.length,
    ...distributionParts.map(({ fraction }) => fraction.length)
  );
  const distributed = distributions.reduce(
    (total, distribution) => total + toScaledUnits(distribution.amount, scale),
    BigInt(0)
  );

  return distributed === toScaledUnits(balance, scale);
}

export function sumDistributionAmounts(
  distributions: DisputeDistribution[]
): string {
  if (distributions.length === 0) return "0";

  const parts = distributions.map(({ amount }) => decimalParts(amount));
  const scale = Math.max(...parts.map(({ fraction }) => fraction.length));
  const total = distributions.reduce(
    (sum, distribution) => sum + toScaledUnits(distribution.amount, scale),
    BigInt(0)
  );

  if (scale === 0) return total.toString();

  const padded = total.toString().padStart(scale + 1, "0");
  const whole = padded.slice(0, -scale);
  const fraction = padded.slice(-scale).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function validateInput(input: ResolveDisputeInput) {
  if (!input.contractId.trim()) {
    throw new DisputeResolutionError("contractId is required");
  }
  if (!input.disputeResolver.trim()) {
    throw new DisputeResolutionError("A dispute resolver wallet is required");
  }
  if (input.distributions.length === 0) {
    throw new DisputeResolutionError("At least one distribution is required");
  }

  const seenAddresses = new Set<string>();
  input.distributions.forEach(({ address, amount }) => {
    const normalizedAddress = address.trim();
    if (!normalizedAddress) {
      throw new DisputeResolutionError("Every distribution needs a recipient address");
    }
    if (seenAddresses.has(normalizedAddress)) {
      throw new DisputeResolutionError("Each recipient address can only appear once");
    }
    seenAddresses.add(normalizedAddress);

    const { fraction } = decimalParts(amount);
    if (toScaledUnits(amount, fraction.length) <= BigInt(0)) {
      throw new DisputeResolutionError("Every distribution amount must be greater than zero");
    }
  });
}

export async function getEscrowBalance(contractId: string): Promise<string> {
  if (!contractId.trim()) {
    throw new DisputeResolutionError("contractId is required");
  }

  const params = new URLSearchParams({ contractId });
  const response = await fetch(
    `/api/escrow/single-release/v2/balance?${params.toString()}`,
    { cache: "no-store" }
  );

  if (!response.ok) {
    throw new DisputeResolutionError(await readError(response));
  }

  const balance = extractBalance(await response.json(), contractId);
  if (balance === null) {
    throw new DisputeResolutionError("Escrow service did not return a balance");
  }

  return balance;
}

export async function resolveEscrowDispute(
  input: ResolveDisputeInput,
  signTransaction: SignDisputeResolutionTransaction,
  onStatusChange?: (status: DisputeResolutionStatus) => void
): Promise<DisputeResolutionResult> {
  try {
    validateInput(input);
    onStatusChange?.("loading-balance");

    const balance = await getEscrowBalance(input.contractId);
    if (!distributionsMatchBalance(input.distributions, balance)) {
      throw new DisputeResolutionError(
        `Distribution total must exactly equal the escrow balance of ${balance}`
      );
    }

    const resolutionResponse = await fetch(
      "/api/escrow/single-release/v2/resolve-dispute",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }
    );

    if (!resolutionResponse.ok) {
      throw new DisputeResolutionError(await readError(resolutionResponse));
    }

    const { unsignedXdr } = (await resolutionResponse.json()) as {
      unsignedXdr?: string;
    };
    if (!unsignedXdr) {
      throw new DisputeResolutionError(
        "Escrow service did not return a resolution transaction"
      );
    }

    onStatusChange?.("requesting-signature");
    let signedXdr: string;
    try {
      signedXdr = await signTransaction(unsignedXdr);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Wallet signature was rejected";
      throw new DisputeResolutionError(message);
    }

    if (!signedXdr) {
      throw new DisputeResolutionError("Wallet did not return a signed transaction");
    }

    onStatusChange?.("submitting");
    const submissionResponse = await fetch("/api/stellar/send-transaction", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signedXdr }),
    });

    if (!submissionResponse.ok) {
      throw new DisputeResolutionError(await readError(submissionResponse));
    }

    const transaction = (await submissionResponse.json()) as unknown;
    const distributions = input.distributions.map(({ address, amount }) => ({
      address: address.trim(),
      amount,
    }));

    onStatusChange?.("resolved");
    return { balance, distributions, transaction };
  } catch (error) {
    onStatusChange?.("failed");
    if (error instanceof DisputeResolutionError) throw error;
    const message = error instanceof Error ? error.message : "Unable to resolve dispute";
    throw new DisputeResolutionError(message);
  }
}
