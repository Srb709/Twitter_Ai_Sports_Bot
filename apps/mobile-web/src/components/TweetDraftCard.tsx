"use client";

import { useState } from "react";
import { Badge } from "./ui/Badge";

interface TweetDraft {
  id: string;
  tweetType: string;
  text: string;
  status: string;
  generationModel: string;
  createdAt: string;
}

interface Props {
  draft: TweetDraft;
  onApprove?: () => void;
  onReject?: () => void;
}

export function TweetDraftCard({ draft, onApprove, onReject }: Props) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(draft.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const charCount = draft.text.length;
  const overLimit = charCount > 280;

  return (
    <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
      <div className="flex items-center justify-between mb-2">
        <Badge label={draft.tweetType.replace(/_/g, " ")} color="blue" />
        <span className={`text-xs font-mono ${overLimit ? "text-red-400" : "text-zinc-500"}`}>
          {charCount}/280
        </span>
      </div>

      <p className="text-sm text-white leading-relaxed whitespace-pre-wrap mb-3">
        {draft.text}
      </p>

      <div className="flex items-center gap-2">
        <button
          onClick={copy}
          className="flex-1 py-2 rounded-lg bg-zinc-800 text-zinc-300 text-sm font-medium active:bg-zinc-700"
        >
          {copied ? "Copied!" : "Copy"}
        </button>

        {draft.status === "DRAFT" && (
          <>
            <button
              onClick={onApprove}
              className="flex-1 py-2 rounded-lg bg-green-700 text-white text-sm font-medium active:bg-green-600"
            >
              Approve
            </button>
            <button
              onClick={onReject}
              className="flex-1 py-2 rounded-lg bg-red-900 text-white text-sm font-medium active:bg-red-800"
            >
              Reject
            </button>
          </>
        )}
      </div>

      <p className="text-xs text-zinc-600 mt-2">
        {draft.generationModel} · {new Date(draft.createdAt).toLocaleString()}
      </p>
    </div>
  );
}
