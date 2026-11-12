import type { Party } from "@arko/shared";

/**
 * Browser-side store of deal capability keys (issued by the API, shareable as invite links).
 * The server verifies every key; this file only remembers which ones this browser holds.
 */
type Ring = Record<string, Partial<Record<Party, string>>>;
const KEY = "arko.keys";

const read = (): Ring => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Ring;
  } catch {
    return {};
  }
};
const write = (r: Ring) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(r));
  } catch {
    /* storage unavailable */
  }
};

/** Decode (not verify) a key's payload to learn which deal/party it is for. */
export function decodeKey(key: string): { dealId: string; party: Party } | null {
  try {
    const json = JSON.parse(atob(key.split(".")[0]!.replace(/-/g, "+").replace(/_/g, "/"))) as { d: string; p: Party };
    return json.d && (json.p === "client" || json.p === "freelancer") ? { dealId: json.d, party: json.p } : null;
  } catch {
    return null;
  }
}

let currentParty: Party = (() => {
  try {
    return (localStorage.getItem("arko.party") as Party) || "client";
  } catch {
    return "client";
  }
})();

export const keyring = {
  all: () => Object.values(read()).flatMap((p) => Object.values(p).filter(Boolean) as string[]),
  get: (dealId: string, party: Party) => read()[dealId]?.[party],
  parties: (dealId: string): Party[] => Object.keys(read()[dealId] ?? {}) as Party[],
  add(key: string): { dealId: string; party: Party } | null {
    const info = decodeKey(key);
    if (!info) return null;
    const r = read();
    r[info.dealId] = { ...r[info.dealId], [info.party]: key };
    write(r);
    return info;
  },
  party: () => currentParty,
  setParty(p: Party) {
    currentParty = p;
    try {
      localStorage.setItem("arko.party", p);
    } catch {
      /* ignore */
    }
  },
};
