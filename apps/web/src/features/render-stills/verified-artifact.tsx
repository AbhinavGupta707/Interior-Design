"use client";

import type { RenderArtifact } from "@interior-design/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import { ActionButton, LoadingIndicator } from "../../components/ui-primitives";
import { renderStillsClient } from "./api";
import {
  ArtifactVerificationError,
  fetchVerifiedArtifact,
  verifyArtifactAccess,
} from "./artifact-verification";
import styles from "./render-stills.module.css";
import { artifactLabel, formatBytes, shortHash } from "./presentation";

type PreviewState =
  | { readonly kind: "error"; readonly message: string }
  | {
      readonly heightPx: number;
      readonly kind: "ready";
      readonly objectUrl?: string;
      readonly widthPx: number;
    }
  | { readonly kind: "idle" | "loading" };

function verificationMessage(reason: unknown): string {
  if (reason instanceof ArtifactVerificationError) {
    if (reason.kind === "tampered") {
      return `Tampered artifact blocked. ${reason.message}`;
    }
    if (reason.kind === "expired") {
      return `Artifact access expired. ${reason.message}`;
    }
    if (reason.kind === "decode") {
      return `Decode failed safely. ${reason.message}`;
    }
    return reason.message;
  }
  return "Artifact verification failed safely. No bytes were displayed.";
}

export function VerifiedArtifact({
  alt,
  artifact,
  autoVerify,
  jobId,
  manifestSha256,
  offline,
  projectId,
}: {
  readonly alt: string;
  readonly artifact: RenderArtifact;
  readonly autoVerify: boolean;
  readonly jobId: string;
  readonly manifestSha256: string;
  readonly offline: boolean;
  readonly projectId: string;
}) {
  const [state, setState] = useState<PreviewState>({ kind: "idle" });
  const [downloadState, setDownloadState] = useState<"idle" | "loading">("idle");
  const activeObjectUrl = useRef<string | undefined>(undefined);
  const verificationGeneration = useRef(0);
  const png = artifact.role.endsWith("-png");

  const clearObjectUrl = useCallback(() => {
    if (activeObjectUrl.current) {
      URL.revokeObjectURL(activeObjectUrl.current);
      activeObjectUrl.current = undefined;
    }
  }, []);

  const verify = useCallback(async () => {
    const generation = verificationGeneration.current + 1;
    verificationGeneration.current = generation;
    if (offline) {
      setState({ kind: "error", message: "Offline inspection mode cannot request fresh bytes." });
      return;
    }
    clearObjectUrl();
    setState({ kind: "loading" });
    try {
      const access = await renderStillsClient.getArtifactAccess(projectId, jobId, artifact);
      const verified = await fetchVerifiedArtifact(access, artifact, manifestSha256);
      if (generation !== verificationGeneration.current) return;
      if (!png) {
        setState({ heightPx: verified.heightPx, kind: "ready", widthPx: verified.widthPx });
        return;
      }
      const objectUrl = URL.createObjectURL(
        new Blob([Uint8Array.from(verified.bytes).buffer], { type: artifact.mediaType }),
      );
      const image = new Image();
      image.src = objectUrl;
      try {
        await image.decode();
      } catch {
        URL.revokeObjectURL(objectUrl);
        throw new ArtifactVerificationError(
          "decode",
          "The verified PNG container could not be decoded by this browser.",
        );
      }
      if (generation !== verificationGeneration.current) {
        URL.revokeObjectURL(objectUrl);
        return;
      }
      if (image.naturalWidth !== verified.widthPx || image.naturalHeight !== verified.heightPx) {
        URL.revokeObjectURL(objectUrl);
        throw new ArtifactVerificationError(
          "tampered",
          "Browser-decoded dimensions contradict verified PNG metadata.",
        );
      }
      activeObjectUrl.current = objectUrl;
      setState({
        heightPx: verified.heightPx,
        kind: "ready",
        objectUrl,
        widthPx: verified.widthPx,
      });
    } catch (reason) {
      if (generation === verificationGeneration.current) {
        setState({ kind: "error", message: verificationMessage(reason) });
      }
    }
  }, [artifact, clearObjectUrl, jobId, manifestSha256, offline, png, projectId]);

  useEffect(() => {
    setState({ kind: "idle" });
    const timeout = autoVerify ? setTimeout(() => void verify(), 0) : undefined;
    return () => {
      if (timeout) clearTimeout(timeout);
      verificationGeneration.current += 1;
      clearObjectUrl();
    };
  }, [autoVerify, clearObjectUrl, verify]);

  const download = async () => {
    if (offline) return;
    setDownloadState("loading");
    try {
      const access = await renderStillsClient.getArtifactAccess(projectId, jobId, artifact);
      const url = verifyArtifactAccess(access, artifact, manifestSha256);
      const anchor = document.createElement("a");
      anchor.href = url.href;
      anchor.download = `${artifact.role}-${artifact.sha256.slice(0, 12)}.${png ? "png" : "exr"}`;
      anchor.rel = "noopener noreferrer";
      anchor.click();
    } catch (reason) {
      setState({ kind: "error", message: verificationMessage(reason) });
    } finally {
      setDownloadState("idle");
    }
  };

  return (
    <section className={styles.artifactPanel} data-preview-state={state.kind}>
      <header>
        <div>
          <p>{artifact.role.endsWith("-exr") ? "Container inspection only" : "Verified preview"}</p>
          <h3>{artifactLabel(artifact.role)}</h3>
        </div>
        <span>
          {String(artifact.widthPx)} × {String(artifact.heightPx)} ·{" "}
          {formatBytes(artifact.byteLength)}
        </span>
      </header>

      {state.kind === "loading" ? (
        <div className={styles.artifactState}>
          <LoadingIndicator label="Requesting fresh access and verifying bytes…" />
        </div>
      ) : null}
      {state.kind === "idle" ? (
        <div className={styles.artifactState}>
          <p>
            Bytes are not loaded until requested. Signed access, type, byte length, SHA-256 and
            dimensions are checked before any object URL is created.
          </p>
        </div>
      ) : null}
      {state.kind === "error" ? (
        <div className={styles.artifactError} role="alert">
          <strong>Artifact withheld</strong>
          <span>{state.message}</span>
        </div>
      ) : null}
      {state.kind === "ready" && state.objectUrl ? (
        <figure className={styles.imageFrame}>
          {/* The object URL exists only after independent byte and browser-decode checks. */}
          <img
            alt={alt}
            height={state.heightPx}
            onError={() => {
              clearObjectUrl();
              setState({
                kind: "error",
                message: "Decode failed after display. The object URL was revoked.",
              });
            }}
            src={state.objectUrl}
            width={state.widthPx}
          />
          <figcaption>
            Verified in this tab · SHA-256 <code>{shortHash(artifact.sha256)}</code>
          </figcaption>
        </figure>
      ) : null}
      {state.kind === "ready" && !state.objectUrl ? (
        <dl className={styles.verifiedMetadata}>
          <div>
            <dt>Signature</dt>
            <dd>OpenEXR container header</dd>
          </div>
          <div>
            <dt>Data window</dt>
            <dd>
              {String(state.widthPx)} × {String(state.heightPx)}
            </dd>
          </div>
          <div>
            <dt>Validation scope</dt>
            <dd>Header and immutable bytes only; channel pixels were not decoded</dd>
          </div>
        </dl>
      ) : null}

      <footer>
        <ActionButton
          disabled={offline || state.kind === "loading"}
          onClick={() => void verify()}
          tone="secondary"
        >
          {state.kind === "error" ? "Request fresh access and retry" : "Verify fresh bytes"}
        </ActionButton>
        <ActionButton
          disabled={offline || downloadState === "loading"}
          onClick={() => void download()}
          tone="secondary"
        >
          {downloadState === "loading"
            ? "Requesting fresh download…"
            : "Fresh verified-access download"}
        </ActionButton>
      </footer>
    </section>
  );
}
