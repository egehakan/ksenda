"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/constants";
import { cn } from "@/lib/utils";

interface PromptEditorProps {
  initialPrompt?: string;
  onSave: (prompt: string) => Promise<void>;
}

/*
 * Prompt editor. Full-bleed mono textarea with a header row above (eyebrow
 * "PROMPT", char count) and a footer row below (reset / save). No card chrome.
 */
export function PromptEditor({ initialPrompt, onSave }: PromptEditorProps) {
  const [prompt, setPrompt] = useState(initialPrompt || DEFAULT_SYSTEM_PROMPT);
  const [isSaving, setIsSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (initialPrompt) setPrompt(initialPrompt);
  }, [initialPrompt]);

  const baseline = initialPrompt || DEFAULT_SYSTEM_PROMPT;
  const dirty = prompt !== baseline;

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(prompt);
      setSavedAt(Date.now());
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-[920px]">
      <div className="flex items-baseline justify-between border-b border-[var(--color-line)] pb-3 mb-5">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.10em] text-[var(--color-fg-subtle)]">
            Prompt
          </span>
          <h1 className="text-[22px] font-medium leading-tight tracking-tight text-[var(--color-fg)]">
            Email generation
          </h1>
        </div>
        <span className="font-mono text-[11px] tabular-nums text-[var(--color-fg-muted)]">
          {prompt.length.toLocaleString()} chars
        </span>
      </div>

      <p className="text-[13px] leading-relaxed text-[var(--color-fg-muted)] mb-6 max-w-[68ch]">
        Instruct the AI to return JSON with{" "}
        <code className="font-mono text-[12px] text-[var(--color-fg)] bg-[var(--color-panel)] px-1">
          subject
        </code>{" "}
        and{" "}
        <code className="font-mono text-[12px] text-[var(--color-fg)] bg-[var(--color-panel)] px-1">
          email_body
        </code>
        . Your sender company context is injected via{" "}
        <code className="font-mono text-[12px] text-[var(--color-fg)] bg-[var(--color-panel)] px-1">
          {`{{SENDER_COMPANY_NAME}}`}
        </code>{" "}
        and{" "}
        <code className="font-mono text-[12px] text-[var(--color-fg)] bg-[var(--color-panel)] px-1">
          {`{{SENDER_COMPANY_WEBSITE}}`}
        </code>
        ; the recipient via{" "}
        <code className="font-mono text-[12px] text-[var(--color-fg)] bg-[var(--color-panel)] px-1">
          {`{{COMPANY_NAME}}`}
        </code>
        ,{" "}
        <code className="font-mono text-[12px] text-[var(--color-fg)] bg-[var(--color-panel)] px-1">
          {`{{COMPANY_WEBSITE_URL}}`}
        </code>
        ,{" "}
        <code className="font-mono text-[12px] text-[var(--color-fg)] bg-[var(--color-panel)] px-1">
          {`{{CONTACT_FIRST_NAME}}`}
        </code>
        .
      </p>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        className={cn(
          "block w-full min-h-[60vh] px-4 py-3",
          "bg-[var(--color-panel)] text-[var(--color-fg)]",
          "border border-[var(--color-line)]",
          "font-mono text-[13px] leading-[1.6]",
          "transition-colors duration-150",
          "focus:outline-none focus:border-[var(--color-accent)]",
          "resize-y"
        )}
        spellCheck={false}
      />

      <div className="flex items-center justify-between pt-4">
        <button
          type="button"
          onClick={() => setPrompt(DEFAULT_SYSTEM_PROMPT)}
          disabled={isSaving}
          className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] transition-colors disabled:opacity-50"
        >
          Reset to default
        </button>
        <div className="flex items-center gap-4">
          {savedAt && !dirty && (
            <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--color-accent)]">
              Saved
            </span>
          )}
          {dirty && (
            <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-muted)]">
              Unsaved
            </span>
          )}
          <Button onClick={handleSave} disabled={isSaving || !dirty}>
            {isSaving ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                Saving
              </>
            ) : (
              "Save prompt"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
