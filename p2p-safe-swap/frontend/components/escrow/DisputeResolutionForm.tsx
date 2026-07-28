"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Plus, RefreshCw, Scale, ShieldAlert, Trash2 } from "lucide-react";
import { Button } from "@/frontend/components/ui/Button/Button";
import {
  DisputeResolutionError,
  distributionsMatchBalance,
  getEscrowBalance,
  resolveEscrowDispute,
  sumDistributionAmounts,
  type DisputeDistribution,
  type DisputeResolutionResult,
  type DisputeResolutionStatus,
  type SignDisputeResolutionTransaction,
} from "@/frontend/lib/dispute-resolution";
import { cn } from "@/lib/utils";
import type { Escrow } from "./types";

export interface DisputeResolutionFormProps {
  escrow: Pick<Escrow, "contractId" | "currency" | "roles">;
  orderStatus: "disputed" | "resolved";
  connectedAddress: string | null;
  signTransaction: SignDisputeResolutionTransaction;
  onResolved: (result: DisputeResolutionResult) => void;
  className?: string;
}

type DistributionRow = DisputeDistribution & { id: string };

const STATUS_COPY: Partial<Record<DisputeResolutionStatus, string>> = {
  "loading-balance": "Checking the latest escrow balance…",
  "requesting-signature": "Waiting for the moderator signature…",
  submitting: "Submitting the signed resolution…",
};

export function DisputeResolutionForm({
  escrow,
  orderStatus,
  connectedAddress,
  signTransaction,
  onResolved,
  className,
}: DisputeResolutionFormProps) {
  const [balance, setBalance] = useState<string | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [status, setStatus] = useState<DisputeResolutionStatus>("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [distributions, setDistributions] = useState<DistributionRow[]>([
    { id: "approver", address: escrow.roles.approver, amount: "" },
    { id: "receiver", address: escrow.roles.receiver, amount: "" },
  ]);

  const isResolver =
    connectedAddress !== null && connectedAddress === escrow.roles.disputeResolver;
  const isSubmitting = ["loading-balance", "requesting-signature", "submitting"].includes(
    status
  );
  const distributionPayload = useMemo(
    () => distributions.map(({ address, amount }) => ({ address, amount })),
    [distributions]
  );

  let distributionTotal: string | null = null;
  let matchesBalance = false;
  try {
    distributionTotal = sumDistributionAmounts(distributionPayload);
    matchesBalance =
      balance !== null && distributionsMatchBalance(distributionPayload, balance);
  } catch {
    distributionTotal = null;
  }

  async function loadBalance() {
    setBalanceError(null);
    try {
      setBalance(await getEscrowBalance(escrow.contractId));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to fetch escrow balance";
      setBalanceError(message);
      setBalance(null);
    }
  }

  useEffect(() => {
    let active = true;

    void getEscrowBalance(escrow.contractId)
      .then((nextBalance) => {
        if (!active) return;
        setBalance(nextBalance);
        setBalanceError(null);
      })
      .catch((error) => {
        if (!active) return;
        const message = error instanceof Error ? error.message : "Unable to fetch escrow balance";
        setBalanceError(message);
      });

    return () => {
      active = false;
    };
  }, [escrow.contractId]);

  function updateDistribution(id: string, field: "address" | "amount", value: string) {
    setDistributions((current) =>
      current.map((distribution) =>
        distribution.id === id ? { ...distribution, [field]: value } : distribution
      )
    );
  }

  async function handleResolve() {
    if (!isResolver || orderStatus !== "disputed") return;

    setSubmitError(null);
    try {
      const result = await resolveEscrowDispute(
        {
          contractId: escrow.contractId,
          disputeResolver: connectedAddress,
          distributions: distributionPayload,
        },
        signTransaction,
        setStatus
      );
      setBalance(result.balance);
      onResolved(result);
    } catch (error) {
      const message =
        error instanceof DisputeResolutionError ? error.message : "Unable to resolve dispute";
      setSubmitError(message);
    }
  }

  if (!connectedAddress || !isResolver) {
    return (
      <section
        aria-labelledby="dispute-resolution-heading"
        className={cn(
          "flex flex-col items-center gap-2 rounded-2xl border border-border bg-card p-6 text-center",
          className
        )}
      >
        <ShieldAlert className="text-muted-foreground" size={28} aria-hidden="true" />
        <h2 id="dispute-resolution-heading" className="font-semibold text-foreground">
          Moderator access required
        </h2>
        <p className="text-sm text-muted-foreground">
          Connect the wallet assigned to this escrow&apos;s disputeResolver role.
        </p>
      </section>
    );
  }

  if (orderStatus === "resolved") {
    return (
      <section
        aria-labelledby="dispute-resolution-heading"
        className={cn(
          "flex flex-col items-center gap-2 rounded-2xl border border-primary/30 bg-primary/10 p-6 text-center",
          className
        )}
      >
        <CheckCircle2 className="text-primary" size={28} aria-hidden="true" />
        <h2 id="dispute-resolution-heading" className="font-semibold text-foreground">
          Dispute resolved
        </h2>
        <p className="text-sm text-muted-foreground">
          The signed transaction was confirmed and the order is now resolved.
        </p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="dispute-resolution-heading"
      className={cn("flex flex-col gap-4 rounded-2xl border border-border bg-card p-5", className)}
    >
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Scale size={18} aria-hidden="true" />
        </span>
        <div>
          <h2 id="dispute-resolution-heading" className="font-semibold text-foreground">
            Resolve dispute
          </h2>
          <p className="text-sm text-muted-foreground">
            Allocate the complete escrow balance, then sign as the assigned moderator.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-xl bg-muted px-3 py-2">
        <div className="flex flex-col">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Escrow balance
          </span>
          <span className="font-semibold tabular-nums text-foreground">
            {balance === null
              ? balanceError
                ? "Unavailable"
                : "Loading…"
              : `${balance} ${escrow.currency}`}
          </span>
        </div>
        <button
          type="button"
          aria-label="Refresh escrow balance"
          onClick={() => void loadBalance()}
          className="cursor-pointer rounded-full p-2 text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <RefreshCw size={16} aria-hidden="true" />
        </button>
      </div>

      {balanceError && (
        <p role="alert" className="text-sm text-destructive">
          {balanceError}
        </p>
      )}

      <div className="flex flex-col gap-3">
        {distributions.map((distribution, index) => (
          <div key={distribution.id} className="rounded-xl border border-border p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Recipient {index + 1}
              </span>
              {distributions.length > 1 && (
                <button
                  type="button"
                  aria-label={`Remove recipient ${index + 1}`}
                  onClick={() =>
                    setDistributions((current) =>
                      current.filter((item) => item.id !== distribution.id)
                    )
                  }
                  className="cursor-pointer rounded-full p-1 text-muted-foreground transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Trash2 size={15} aria-hidden="true" />
                </button>
              )}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                aria-label={`Recipient ${index + 1} address`}
                placeholder="Stellar address"
                value={distribution.address}
                onChange={(event) =>
                  updateDistribution(distribution.id, "address", event.target.value)
                }
                className="min-w-0 flex-1 rounded-xl border border-border bg-transparent px-3 py-2 font-mono text-xs text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <input
                type="text"
                inputMode="decimal"
                aria-label={`Recipient ${index + 1} amount`}
                placeholder="0.00"
                value={distribution.amount}
                onChange={(event) =>
                  updateDistribution(distribution.id, "amount", event.target.value)
                }
                className="w-full rounded-xl border border-border bg-transparent px-3 py-2 text-sm tabular-nums text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-32"
              />
            </div>
          </div>
        ))}

        <button
          type="button"
          onClick={() =>
            setDistributions((current) => [
              ...current,
              { id: crypto.randomUUID(), address: "", amount: "" },
            ])
          }
          className="flex cursor-pointer items-center justify-center gap-1 rounded-xl border border-dashed border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus size={16} aria-hidden="true" />
          Add recipient
        </button>
      </div>

      <div className="flex items-center justify-between border-t border-border pt-3 text-sm">
        <span className="text-muted-foreground">Distribution total</span>
        <span
          className={cn(
            "font-semibold tabular-nums",
            matchesBalance ? "text-primary" : "text-destructive"
          )}
        >
          {distributionTotal ?? "Invalid amount"} {escrow.currency}
        </span>
      </div>

      {balance !== null && !matchesBalance && (
        <p role="alert" className="text-sm text-destructive">
          Distribution amounts must total exactly {balance} {escrow.currency}.
        </p>
      )}
      {submitError && (
        <p role="alert" className="text-sm text-destructive">
          {submitError}
        </p>
      )}
      {STATUS_COPY[status] && (
        <p role="status" className="text-sm text-muted-foreground">
          {STATUS_COPY[status]}
        </p>
      )}

      <Button
        variant="primary"
        size="lg"
        label={isSubmitting ? "Resolving…" : "Confirm distribution and resolve"}
        onClick={() => void handleResolve()}
        disabled={isSubmitting || balance === null || !matchesBalance}
        className="w-full"
      />
    </section>
  );
}
