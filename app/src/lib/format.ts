import { BN } from "@coral-xyz/anchor";

export function parseUnits(
  value: string,
  decimals: number
): BN {
  const normalized =
    value.trim();

  if (!normalized) {
    throw new Error(
      "Amount is required."
    );
  }

  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error(
      "Enter a valid positive number."
    );
  }

  const [whole, fraction = ""] =
    normalized.split(".");

  if (
    fraction.length >
    decimals
  ) {
    throw new Error(
      `Maximum ${decimals} decimal places allowed.`
    );
  }

  const base =
    new BN(10).pow(
      new BN(decimals)
    );

  const wholePart =
    new BN(whole).mul(base);

  const paddedFraction =
    fraction.padEnd(
      decimals,
      "0"
    );

  const fractionPart =
    paddedFraction
      ? new BN(paddedFraction)
      : new BN(0);

  return wholePart.add(
    fractionPart
  );
}

export function formatUnits(
  value:
    | BN
    | bigint
    | number
    | string,
  decimals: number,
  maxFraction = decimals
): string {
  const raw =
    typeof value === "bigint"
      ? value.toString()
      : value instanceof BN
        ? value.toString()
        : String(value);

  if (decimals === 0) {
    return raw;
  }

  const padded =
    raw.padStart(
      decimals + 1,
      "0"
    );

  const whole =
    padded.slice(
      0,
      -decimals
    );

  const fraction =
    padded.slice(
      -decimals
    );

  const trimmed =
    fraction
      .slice(
        0,
        maxFraction
      )
      .replace(/0+$/, "");

  return trimmed
    ? `${whole}.${trimmed}`
    : whole;
}

export function shortenAddress(
  address: string,
  chars = 4
): string {
  return `${address.slice(
    0,
    chars
  )}…${address.slice(-chars)}`;
}

export function statusLabel(
  status: Record<string, unknown>
): string {
  if ("pending" in status)
    return "Pending";

  if ("ready" in status)
    return "Ready";

  if ("executed" in status)
    return "Executed";

  if ("cancelled" in status)
    return "Cancelled";

  return "Unknown";
}

export function statusClass(
  status: Record<string, unknown>
): string {
  if ("pending" in status)
    return "status-pending";

  if ("ready" in status)
    return "status-ready";

  if ("executed" in status)
    return "status-executed";

  if ("cancelled" in status)
    return "status-cancelled";

  return "";
}