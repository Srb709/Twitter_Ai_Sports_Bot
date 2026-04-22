"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";

interface Pick {
  id: string;
  sport: string;
  normalizedLabel: string;
  marketType: string;
  betSide: string | null;
  line: number | null;
  odds: number | null;
  confidence: number;
  createdAt: string;
}

export default function PicksPage() {
  const [picks, setPicks] = useState<Pick[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/picks")
      .then((r) => r.json())
      .then((d) => setPicks(d.picks ?? []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-4 pb-24">
      <h1 className="text-xl font-bold mb-4">Extracted Picks</h1>

      {loading ? (
        <p className="text-zinc-400 text-sm">Loading...</p>
      ) : picks.length === 0 ? (
        <p className="text-zinc-400 text-sm">No picks extracted yet.</p>
      ) : (
        <div className="space-y-3">
          {picks.map((p) => (
            <div key={p.id} className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
              <div className="flex items-center gap-2 mb-1">
                <Badge label={p.sport} color="blue" />
                <Badge label={p.marketType.replace(/_/g, " ")} color="zinc" />
              </div>

              <p className="text-base font-semibold text-white mb-1">{p.normalizedLabel}</p>

              <div className="flex items-center gap-3 text-sm text-zinc-400">
                {p.odds !== undefined && p.odds !== null && (
                  <span className={p.odds > 0 ? "text-green-400" : "text-zinc-400"}>
                    {p.odds > 0 ? "+" : ""}{p.odds}
                  </span>
                )}
                <span>Confidence: {Math.round(p.confidence * 100)}%</span>
              </div>

              <p className="text-xs text-zinc-600 mt-1">
                {new Date(p.createdAt).toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
