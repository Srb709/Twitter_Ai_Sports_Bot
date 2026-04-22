"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";

interface Account {
  id: string;
  username: string;
  displayName: string;
  active: boolean;
  priority: number;
  sportFocus: string[];
  lastScannedAt: string | null;
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    fetch("/api/accounts")
      .then((r) => r.json())
      .then((d) => setAccounts(d.accounts ?? []))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const toggle = async (id: string, active: boolean) => {
    await fetch(`/api/accounts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !active }),
    });
    load();
  };

  return (
    <div className="p-4 pb-24">
      <h1 className="text-xl font-bold mb-4">Tracked Accounts</h1>

      {loading ? (
        <p className="text-zinc-400 text-sm">Loading...</p>
      ) : accounts.length === 0 ? (
        <p className="text-zinc-400 text-sm">No accounts. Run pnpm db:seed first.</p>
      ) : (
        <div className="space-y-3">
          {accounts.map((a) => (
            <div key={a.id} className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
              <div className="flex items-center justify-between mb-1">
                <div>
                  <span className="font-semibold text-white">@{a.username}</span>
                  {a.displayName && (
                    <span className="text-zinc-400 text-sm ml-2">{a.displayName}</span>
                  )}
                </div>
                <button
                  onClick={() => toggle(a.id, a.active)}
                  className={`text-xs px-3 py-1 rounded-full font-medium ${
                    a.active
                      ? "bg-green-900 text-green-300"
                      : "bg-zinc-800 text-zinc-500"
                  }`}
                >
                  {a.active ? "Active" : "Paused"}
                </button>
              </div>

              <div className="flex items-center gap-2 mt-2">
                <Badge label={`Priority ${a.priority}`} color="zinc" />
                {a.sportFocus.map((s) => (
                  <Badge key={s} label={s} color="blue" />
                ))}
              </div>

              <p className="text-xs text-zinc-600 mt-2">
                Last scan: {a.lastScannedAt ? new Date(a.lastScannedAt).toLocaleString() : "Never"}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
