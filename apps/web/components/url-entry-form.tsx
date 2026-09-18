"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiClient, type Error as ApiError, type Project } from "@/lib/api-client";

/** Build plan risk: cold starts can make cloning slow; surface a hint after this long. */
const SLOW_CLONE_HINT_DELAY_MS = 5_000;

/**
 * Validates `raw` as an absolute http(s) URL, normalising a bare host
 * (`example.com`) to `https://example.com`. Returns `null` when the input
 * cannot be turned into a valid http(s) URL.
 */
function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const parse = (value: string): string | null => {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
    } catch {
      return null;
    }
  };

  return parse(trimmed) ?? parse(`https://${trimmed}`);
}

function isApiError(error: unknown): error is ApiError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error &&
    typeof (error as { code: unknown }).code === "string"
  );
}

/** Maps a thrown mutation error (typed API error or network failure) to a human message. */
function describeError(error: unknown): string {
  if (isApiError(error)) {
    switch (error.code) {
      case "invalid_url":
        return "Enter a valid http(s) URL, like https://example.com.";
      case "clone_failed":
        return `Could not clone that page: ${error.message}`;
      default:
        return error.message;
    }
  }
  return "Could not reach Vibe Motion. Check your connection and try again.";
}

export function UrlEntryForm() {
  const router = useRouter();
  const errorId = useId();
  const hintId = useId();

  const [url, setUrl] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [showSlowHint, setShowSlowHint] = useState(false);

  const mutation = useMutation<Project, ApiError | Error, string>({
    mutationFn: async (sourceUrl: string) => {
      const { data, error } = await apiClient.POST("/projects", {
        body: { url: sourceUrl },
      });
      if (error) throw error;
      return data as Project;
    },
    onSuccess: (project) => {
      router.push(`/p/${project.id}`);
    },
  });

  useEffect(() => {
    if (!mutation.isPending) return;
    const timer = setTimeout(() => setShowSlowHint(true), SLOW_CLONE_HINT_DELAY_MS);
    return () => {
      clearTimeout(timer);
      setShowSlowHint(false);
    };
  }, [mutation.isPending]);

  const errorMessage =
    validationError ?? (mutation.isError ? describeError(mutation.error) : null);

  const describedBy =
    [errorMessage ? errorId : null, showSlowHint ? hintId : null].filter(Boolean).join(" ") ||
    undefined;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = normalizeUrl(url);
    if (!normalized) {
      setValidationError("Enter a valid http(s) URL, like https://example.com.");
      return;
    }
    setValidationError(null);
    mutation.mutate(normalized);
  }

  return (
    <form className="flex flex-col gap-2" onSubmit={handleSubmit} noValidate>
      <label htmlFor="source-url" className="text-sm font-medium text-foreground">
        Page URL
      </label>
      <div className="flex gap-2">
        <Input
          id="source-url"
          name="url"
          type="url"
          inputMode="url"
          autoComplete="off"
          placeholder="https://example.com"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          readOnly={mutation.isPending}
          aria-invalid={errorMessage ? true : undefined}
          aria-describedby={describedBy}
          className="flex-1"
        />
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? "Cloning…" : "Clone page"}
        </Button>
      </div>
      {errorMessage ? (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {errorMessage}
        </p>
      ) : null}
      {showSlowHint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          Still cloning — large pages can take up to 15 seconds.
        </p>
      ) : null}
    </form>
  );
}
