"use client";

import { useState } from "react";
import { requestAccess, signTransaction } from "@stellar/freighter-api";
import { DisputeResolutionForm } from "./DisputeResolutionForm";
import { EscrowAdminUpdateForm } from "./EscrowAdminUpdateForm";
import { Button } from "@/frontend/components/ui/Button/Button";
import type { Escrow } from "./types";
import type { DisputeResolutionResult } from "@/frontend/lib/dispute-resolution";

const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
const PUBLIC_NETWORK_PASSPHRASE = "Public Global Stellar Network ; September 2015";

interface EscrowModeratorPageProps {
  escrow: Escrow;
  orderId: string;
  network: "testnet" | "mainnet";
}

interface ModeratorOrderState {
  id: string;
  status: "disputed" | "resolved";
  finalDistributions?: DisputeResolutionResult["distributions"];
}

export function EscrowModeratorPage({ escrow, orderId, network }: EscrowModeratorPageProps) {
  const [connectedAddress, setConnectedAddress] = useState<string | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [order, setOrder] = useState<ModeratorOrderState>({
    id: orderId,
    status: "disputed",
  });
  const resolvedEscrow: Escrow = {
    ...escrow,
    status: order.status,
    finalDistributions: order.finalDistributions,
  };

  async function connectModeratorWallet() {
    setWalletError(null);
    try {
      const result = await requestAccess();
      if (result.error) {
        setWalletError(result.error.message);
        return;
      }
      setConnectedAddress(result.address);
    } catch (error) {
      setWalletError(
        error instanceof Error ? error.message : "Unable to connect the moderator wallet"
      );
    }
  }

  async function signResolution(unsignedXdr: string): Promise<string> {
    if (!connectedAddress) throw new Error("Connect the moderator wallet first");
    if (connectedAddress !== escrow.roles.disputeResolver) {
      throw new Error("The connected wallet does not have the disputeResolver role");
    }

    const networkPassphrase =
      network === "mainnet" ? PUBLIC_NETWORK_PASSPHRASE : TESTNET_PASSPHRASE;
    const result = await signTransaction(unsignedXdr, {
      networkPassphrase,
      address: connectedAddress,
    });
    if (result.error) throw new Error(result.error.message);
    return result.signedTxXdr;
  }

  function handleResolved(result: DisputeResolutionResult) {
    setOrder((current) => ({
      ...current,
      status: "resolved",
      finalDistributions: result.distributions,
    }));
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 p-4 sm:p-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Order {order.id}
          </p>
          <h1 className="text-lg font-semibold capitalize text-foreground">
            Status: {order.status}
          </h1>
        </div>
        <Button
          variant="ghost"
          size="sm"
          label={connectedAddress ? "Wallet connected" : "Connect moderator"}
          onClick={() => void connectModeratorWallet()}
        />
      </header>

      {walletError && (
        <p role="alert" className="text-sm text-destructive">
          {walletError}
        </p>
      )}

      <DisputeResolutionForm
        escrow={resolvedEscrow}
        orderStatus={order.status}
        connectedAddress={connectedAddress}
        signTransaction={signResolution}
        onResolved={handleResolved}
      />

      {order.status === "resolved" && order.finalDistributions && (
        <section
          aria-labelledby="final-distribution-heading"
          className="rounded-2xl border border-border bg-card p-5"
        >
          <h2 id="final-distribution-heading" className="mb-3 font-semibold text-foreground">
            Final fund distribution
          </h2>
          <ul className="flex flex-col gap-2">
            {order.finalDistributions.map((distribution) => (
              <li
                key={distribution.address}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <code className="truncate text-xs text-muted-foreground">
                  {distribution.address}
                </code>
                <span className="shrink-0 font-semibold tabular-nums text-foreground">
                  {distribution.amount} {escrow.currency}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <EscrowAdminUpdateForm
        escrow={resolvedEscrow}
        isAdmin={connectedAddress === escrow.roles.disputeResolver}
      />
    </main>
  );
}
