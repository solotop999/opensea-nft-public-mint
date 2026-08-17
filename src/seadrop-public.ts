// Build SeaDrop public-mint calldata locally, with no OpenSea involvement.
//
// A public stage is unsigned: SeaDrop.mintPublic() takes only the drop's own
// parameters, so the whole transaction can be assembled from on-chain reads.
// That removes the access token, its expiry, OpenSea's rate limits, and — the
// part that actually matters for FCFS — the ~1s API round-trip from the
// critical path, because every tx can be signed before the stage even opens.
//
// The allowlist/FCFS stage is different in kind: mintSigned() carries a
// server-produced signature bound to one wallet, so that path still needs
// OpenSea and there is no local equivalent.

import { Contract, Interface, JsonRpcProvider } from "ethers";

export const SEADROP_ADDRESS = "0x00005EA00Ac477B1030CE78506496e8C2dE24bf5";

// OpenSea's standard fee collector — the usual allowed recipient on their drops.
// Only used when a drop leaves the recipient list empty and unrestricted, since
// SeaDrop rejects the zero address outright.
const OPENSEA_FEE_RECIPIENT = "0x0000a26b00c1F0DF003000390027140000fAa719";

const PUBLIC_ABI = [
  "function mintPublic(address nftContract, address feeRecipient, address minterIfNotPayer, uint256 quantity) payable",
  "function getPublicDrop(address nftContract) view returns (tuple(uint80 mintPrice, uint48 startTime, uint48 endTime, uint16 maxTotalMintableByWallet, uint16 feeBps, bool restrictFeeRecipients))",
  "function getAllowedFeeRecipients(address nftContract) view returns (address[])",
];

const IFACE = new Interface(PUBLIC_ABI);

export interface PublicDrop {
  mintPrice: bigint;
  startTime: number;
  endTime: number;
  maxTotalMintableByWallet: number;
  feeBps: number;
  restrictFeeRecipients: boolean;
}

export interface LocalMintPlan {
  to: string; // always the SeaDrop singleton
  data: string; // identical for every wallet — see minterIfNotPayer below
  value: bigint; // mintPrice × quantity, exactly what SeaDrop expects
  drop: PublicDrop;
  feeRecipient: string;
}

// Returns null when this contract has no public drop on the SeaDrop singleton —
// either it isn't a SeaDrop collection at all, or it uses a newer variant that
// keeps drop config on the token contract itself.
export async function fetchPublicDrop(
  rpcUrl: string,
  nftContract: string
): Promise<PublicDrop | null> {
  const provider = new JsonRpcProvider(rpcUrl);
  const seadrop = new Contract(SEADROP_ADDRESS, PUBLIC_ABI, provider);

  try {
    const raw = await seadrop.getPublicDrop(nftContract);
    const drop: PublicDrop = {
      mintPrice: BigInt(raw.mintPrice),
      startTime: Number(raw.startTime),
      endTime: Number(raw.endTime),
      maxTotalMintableByWallet: Number(raw.maxTotalMintableByWallet),
      feeBps: Number(raw.feeBps),
      restrictFeeRecipients: Boolean(raw.restrictFeeRecipients),
    };
    // An unset mapping entry decodes to all zeros rather than reverting.
    if (drop.startTime === 0 && drop.endTime === 0 && drop.maxTotalMintableByWallet === 0) {
      return null;
    }
    return drop;
  } catch {
    return null;
  }
}

// SeaDrop reverts on a zero fee recipient, and on a disallowed one when the drop
// restricts them — so this has to come from the chain, not a guess.
export async function resolveFeeRecipient(
  rpcUrl: string,
  nftContract: string,
  restricted: boolean
): Promise<{ address: string; source: string } | null> {
  const provider = new JsonRpcProvider(rpcUrl);
  const seadrop = new Contract(SEADROP_ADDRESS, PUBLIC_ABI, provider);

  let allowed: string[] = [];
  try {
    allowed = await seadrop.getAllowedFeeRecipients(nftContract);
  } catch {
    allowed = [];
  }

  if (allowed.length > 0) {
    return { address: allowed[0], source: "allowed fee recipient on-chain" };
  }
  if (restricted) {
    // Nothing allowed and the drop enforces the list — a public mint cannot be
    // constructed at all, locally or otherwise.
    return null;
  }
  return { address: OPENSEA_FEE_RECIPIENT, source: "OpenSea default (drop does not restrict)" };
}

// minterIfNotPayer = address(0) means "credit the caller", so the calldata is
// byte-identical for every wallet and can be encoded once and shared.
export function encodeMintPublic(
  nftContract: string,
  feeRecipient: string,
  quantity: number
): string {
  return IFACE.encodeFunctionData("mintPublic", [
    nftContract,
    feeRecipient,
    "0x0000000000000000000000000000000000000000",
    BigInt(quantity),
  ]);
}

export async function buildLocalMintPlan(
  rpcUrl: string,
  nftContract: string,
  quantity: number
): Promise<LocalMintPlan | null> {
  const drop = await fetchPublicDrop(rpcUrl, nftContract);
  if (!drop) return null;

  const fee = await resolveFeeRecipient(rpcUrl, nftContract, drop.restrictFeeRecipients);
  if (!fee) return null;

  return {
    to: SEADROP_ADDRESS,
    data: encodeMintPublic(nftContract, fee.address, quantity),
    value: drop.mintPrice * BigInt(quantity),
    drop,
    feeRecipient: fee.address,
  };
}
