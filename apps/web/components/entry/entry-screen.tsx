"use client";

import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";

import { TopBar } from "@/components/top-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiClient, type Project } from "@/lib/api-client";
import {
  getRecentProjectsSnapshot,
  getServerRecentProjects,
  rememberRecentProject,
  subscribeRecentProjects,
} from "@/lib/recent-projects";
import { hostAndPath, normalizeSourceUrl, stripHttpsScheme } from "@/lib/source-url";

import {
  CloneRequestError,
  INVALID_URL_FAILURE,
  describeCloneFailure,
  isAbortError,
  type CloneFailure,
} from "./clone-failure";
import { CloneFailureNotice, OtherCloneFailureReasons } from "./clone-failure-notice";
import { CloningCard } from "./cloning-card";
import { RecentProjects } from "./recent-projects";

/** Build plan risk: cold starts can make cloning slow; say so after this long. */
const SLOW_CLONE_HINT_SECONDS = 5;

/**
 * `/` — the handoff's Entry screen (`docs/design/README.md` "1. Entry",
 * `docs/design/ui_kit/Entry.jsx`).
 *
 * Paste a URL, watch it clone, land in the editor. The handoff's "Cloned"
 * preview card and its "Open in editor →" step are deliberately not built: the
 * docs redirect straight to `/p/<id>` on success (ruling in
 * docs/plans/phase-3-web-shell.md, "Design handoff").
 */
export function EntryScreen() {
  const router = useRouter();
  const fieldId = useId();
  const failureId = useId();

  /** Everything after `https://` — the scheme is the field's prefix. */
  const [value, setValue] = useState("");
  const [validationFailure, setValidationFailure] = useState<CloneFailure | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // `localStorage` is not there while the page renders on the server, so the
  // column comes in as an external store rather than as an effect: the server
  // and the first client render agree on "nothing yet", and a clone finishing
  // anywhere — this screen, the editor, another tab — refreshes it.
  const recent = useSyncExternalStore(
    subscribeRecentProjects,
    getRecentProjectsSnapshot,
    getServerRecentProjects,
  );

  /** Lets Cancel abort the in-flight clone; `useMutation` has no signal of its own. */
  const abortRef = useRef<AbortController | null>(null);

  const mutation = useMutation<Project, unknown, string>({
    mutationFn: async (sourceUrl) => {
      const controller = new AbortController();
      abortRef.current = controller;
      const { data, error, response } = await apiClient.POST("/projects", {
        body: { url: sourceUrl },
        signal: controller.signal,
      });
      if (error) throw new CloneRequestError(response.status, error.code, error.message);
      return data;
    },
    onSuccess: (project) => {
      rememberRecentProject({
        id: project.id,
        title: project.title,
        sourceUrl: project.sourceUrl,
      });
      router.push(`/p/${project.id}`);
    },
  });

  const isCloning = mutation.isPending;

  // The handoff's "· 4 s". A real counter — there is nothing else true to show.
  // It is zeroed when a clone starts, not here, so the effect only ever sets
  // state from its own interval.
  useEffect(() => {
    if (!isCloning) return;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [isCloning]);

  // An aborted request is a cancel, not a failure: it never becomes a message.
  const requestFailure =
    mutation.isError && !isAbortError(mutation.error)
      ? describeCloneFailure(mutation.error)
      : null;
  const failure = validationFailure ?? requestFailure;

  function handleChange(next: string) {
    setValue(stripHttpsScheme(next));
    // Editing starts a new attempt, so last attempt's verdict goes with it.
    if (validationFailure) setValidationFailure(null);
    if (mutation.isError) mutation.reset();
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const sourceUrl = normalizeSourceUrl(value);
    if (!sourceUrl) {
      mutation.reset();
      setValidationFailure(INVALID_URL_FAILURE);
      return;
    }
    setValidationFailure(null);
    setElapsedSeconds(0);
    mutation.mutate(sourceUrl);
  }

  function handleCancel() {
    abortRef.current?.abort();
    abortRef.current = null;
  }

  return (
    <>
      <TopBar
        actions={
          <Link
            href="/help"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-vm-bar-ink-muted transition-colors duration-(--dur-fast) ease-standard hover:text-vm-bar-ink"
          >
            Help <span aria-hidden="true">↗</span>
          </Link>
        }
      />

      <main className="grid min-h-0 flex-1 grid-cols-[1.35fr_1fr] gap-14 px-[120px] pt-9 pb-[60px]">
        <div className="flex min-w-0 flex-col gap-5">
          <h1 className="text-xl leading-tight font-bold tracking-tight">
            Animate any page.
            <br />
            <span className="font-medium text-vm-ink-2">Paste a URL to clone it.</span>
          </h1>

          <form className="flex flex-col gap-2" onSubmit={handleSubmit} noValidate>
            <label htmlFor={fieldId} className="sr-only">
              Page URL
            </label>
            <div className="flex gap-2">
              <Input
                id={fieldId}
                name="url"
                // Not `type="url"`: the value carries no scheme, so the browser
                // would call every valid entry invalid.
                type="text"
                inputMode="url"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder="nimbus.app/pricing"
                size="xl"
                prefix="https://"
                className="flex-1"
                value={value}
                onChange={(event) => handleChange(event.target.value)}
                readOnly={isCloning}
                aria-invalid={failure ? true : undefined}
                aria-describedby={failure ? failureId : undefined}
              />
              <Button type="submit" variant="ink" size="xl" disabled={isCloning}>
                {failure ? "Retry" : "Clone"}
              </Button>
            </div>
            {failure ? <CloneFailureNotice id={failureId} failure={failure} /> : null}
          </form>

          {isCloning ? (
            <CloningCard
              label={hostAndPath(normalizeSourceUrl(value) ?? value)}
              elapsedSeconds={elapsedSeconds}
              slowHint={elapsedSeconds >= SLOW_CLONE_HINT_SECONDS}
              onCancel={handleCancel}
            />
          ) : null}

          {failure?.showOtherReasons ? <OtherCloneFailureReasons /> : null}
        </div>

        <RecentProjects projects={recent} dimmed={isCloning} />
      </main>
    </>
  );
}
