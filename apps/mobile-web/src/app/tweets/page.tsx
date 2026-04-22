"use client";

import { useEffect, useState } from "react";
import { TweetDraftCard } from "@/components/TweetDraftCard";

interface TweetDraft {
  id: string;
  tweetType: string;
  text: string;
  status: string;
  generationModel: string;
  createdAt: string;
}

export default function TweetsPage() {
  const [drafts, setDrafts] = useState<TweetDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"DRAFT" | "APPROVED" | "REJECTED">("DRAFT");

  const load = async () => {
    setLoading(true);
    const res = await fetch(`/api/tweets?status=${filter}`);
    const data = await res.json();
    setDrafts(data.drafts ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [filter]);

  const handleAction = async (id: string, action: "approve" | "reject") => {
    await fetch(`/api/tweets/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: action === "approve" ? "APPROVED" : "REJECTED" }),
    });
    load();
  };

  return (
    <div className="p-4 pb-24">
      <h1 className="text-xl font-bold mb-4">Tweet Drafts</h1>

      <div className="flex gap-2 mb-4">
        {(["DRAFT", "APPROVED", "REJECTED"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
              filter === s
                ? "bg-blue-600 text-white"
                : "bg-zinc-800 text-zinc-400"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-zinc-400 text-sm">Loading...</p>
      ) : drafts.length === 0 ? (
        <p className="text-zinc-400 text-sm">No {filter.toLowerCase()} drafts.</p>
      ) : (
        <div className="space-y-3">
          {drafts.map((d) => (
            <TweetDraftCard
              key={d.id}
              draft={d}
              onApprove={() => handleAction(d.id, "approve")}
              onReject={() => handleAction(d.id, "reject")}
            />
          ))}
        </div>
      )}
    </div>
  );
}
