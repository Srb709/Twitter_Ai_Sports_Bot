"use client";

import { useEffect, useState } from "react";

interface SpendData {
  currentSpendUsd: number;
  budgetUsd: number;
  percentUsed: number;
  monthKey: string;
}

export default function SettingsPage() {
  const [spend, setSpend] = useState<SpendData | null>(null);

  useEffect(() => {
    fetch("/api/settings/spend")
      .then((r) => r.json())
      .then(setSpend)
      .catch(() => null);
  }, []);

  const barWidth = spend ? Math.min(spend.percentUsed, 100) : 0;
  const barColor =
    barWidth > 90 ? "bg-red-500" : barWidth > 75 ? "bg-yellow-500" : "bg-green-500";

  return (
    <div className="p-4 pb-24">
      <h1 className="text-xl font-bold mb-6">Settings</h1>

      <section className="bg-zinc-900 rounded-xl p-4 border border-zinc-800 mb-4">
        <h2 className="text-sm font-semibold text-zinc-400 mb-3">AI Budget</h2>

        {spend ? (
          <>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-white">${spend.currentSpendUsd.toFixed(4)} spent</span>
              <span className="text-zinc-400">${spend.budgetUsd} cap</span>
            </div>

            <div className="w-full bg-zinc-800 rounded-full h-2 mb-2">
              <div
                className={`${barColor} h-2 rounded-full transition-all`}
                style={{ width: `${barWidth}%` }}
              />
            </div>

            <p className="text-xs text-zinc-500">
              {spend.percentUsed.toFixed(1)}% used this month ({spend.monthKey})
            </p>
          </>
        ) : (
          <p className="text-zinc-500 text-sm">Loading spend data...</p>
        )}
      </section>

      <section className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-400 mb-3">Environment</h2>
        <div className="space-y-2 text-sm">
          <Row label="AI Provider" value={process.env.NEXT_PUBLIC_AI_PROVIDER ?? "anthropic"} />
          <Row label="Budget Cap" value={`$${process.env.NEXT_PUBLIC_BUDGET_USD ?? "20"}/mo`} />
        </div>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-zinc-400">{label}</span>
      <span className="text-white font-mono text-xs">{value}</span>
    </div>
  );
}
