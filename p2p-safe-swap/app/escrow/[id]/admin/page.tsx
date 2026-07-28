import { EscrowModeratorPage } from "@/frontend/components/escrow/EscrowModeratorPage";
import type { Escrow } from "@/frontend/components/escrow/types";

const MOCK_ESCROW: Escrow = {
  contractId: "esc-diego-v",
  status: "disputed",
  amount: 1500,
  currency: "USDC",
  platformFee: 1.5,
  roles: {
    approver: "GABC3DEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNOPQR",
    serviceProvider: "GXYZ3ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNO",
    releaseSigner: "GLMN3OPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ012",
    disputeResolver: "",
    receiver: "GRST3UVWXYZ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ01234567",
    platformAddress: "GUVW3XYZ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789A",
  },
  milestones: [
    { id: "ms-1", description: "Entrega inicial", amount: 500 },
    { id: "ms-2", description: "Entrega final", amount: 1000 },
  ],
};

interface EscrowAdminPageProps {
  params: Promise<{ id: string }>;
}

export default async function EscrowAdminPage({ params }: EscrowAdminPageProps) {
  const { id } = await params;
  const escrow: Escrow = {
    ...MOCK_ESCROW,
    contractId: id,
    roles: {
      ...MOCK_ESCROW.roles,
      disputeResolver: process.env.DISPUTE_RESOLVER_ADDRESS ?? "",
    },
  };

  return (
    <EscrowModeratorPage
      escrow={escrow}
      orderId={`order-${id}`}
      network={process.env.TW_NETWORK === "mainnet" ? "mainnet" : "testnet"}
    />
  );
}
