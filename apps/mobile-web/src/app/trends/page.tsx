"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";

interface Cluster {
  id: string;
  label: string;
  sport: string | null;
  clusterType: string;
  trendScore: number;
  supportCount: number;
  tags: string[];
  updatedAt: string;
}

export default function TrendsPage() {
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/trends")
      .then((r) => r.json())
      .then((d) => setClusters(d.clusters ?? []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-4 pb-24">
      <h1 className="text-xl font-bold mb-4">Trending Picks</h1>

      {loading ? (
        <p className="text-zinc-400 text-sm">Loading...</p>
      ) : clusters.length === 0 ? (
        <p className="text-zinc-400 text-sm">No clusters yet. Run the worker first.</p>
      ) : (
        <div className="space-y-3">
          {clusters.map((c) => (
            <div key={c.id} className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
              <div className="flex items-center justify-between mb-1">
                <span className="font-semibold text-white">{c.label}</span>
                <span className="text-sm font-mono text-blue-400">
                  {c.trendScore.toFixed(2)}
                </span>
              </div>

              <div className="flex items-center gap-2 mb-2">
                {c.sport && <Badge label={c.sport} color="green" />}
                <Badge label={`${c.supportCount} accounts`} color="zinc" />
              </div>

              <div className="flex flex-wrap gap-1">
                {c.tags.map((t) => (
                  <span key={t} className="text-xs bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded-full">
                    {t}
                  </span>
                ))}
              </div>

              <p className="text-xs text-zinc-600 mt-2">
                Updated {new Date(c.updatedAt).toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
