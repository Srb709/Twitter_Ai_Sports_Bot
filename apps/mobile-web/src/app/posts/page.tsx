"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";

interface Post {
  id: string;
  externalUrl: string;
  textContent: string;
  postedAt: string | null;
  scrapedAt: string;
  processed: boolean;
  trackedAccount: { username: string };
}

export default function PostsPage() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/posts")
      .then((r) => r.json())
      .then((d) => setPosts(d.posts ?? []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-4 pb-24">
      <h1 className="text-xl font-bold mb-4">Scraped Posts</h1>

      {loading ? (
        <p className="text-zinc-400 text-sm">Loading...</p>
      ) : posts.length === 0 ? (
        <p className="text-zinc-400 text-sm">No posts yet.</p>
      ) : (
        <div className="space-y-3">
          {posts.map((p) => (
            <div key={p.id} className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-semibold text-zinc-300">@{p.trackedAccount.username}</span>
                <Badge label={p.processed ? "Processed" : "Pending"} color={p.processed ? "green" : "zinc"} />
              </div>

              <p className="text-sm text-zinc-200 leading-relaxed line-clamp-4 mb-2">
                {p.textContent || <span className="text-zinc-500 italic">No text</span>}
              </p>

              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-500">
                  {p.postedAt ? new Date(p.postedAt).toLocaleDateString() : "Unknown date"}
                </span>
                <a
                  href={p.externalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-500"
                >
                  View
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
