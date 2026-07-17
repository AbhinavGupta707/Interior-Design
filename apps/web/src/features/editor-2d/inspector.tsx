"use client";

import {
  attributedUserValue,
  buildCorrectElementMetadataOperation,
  buildCorrectElementProvenanceOperation,
  buildCreateLevelOperation,
  buildCreateSpaceOperation,
  buildCreateWallOperation,
  buildInsertOpeningOperation,
  buildRenameSpaceOperation,
  buildTranslateWallOperation,
  createUserAttribution,
  snapTranslationMm,
} from "@interior-design/editor-core";
import type { CanonicalElementSelection, EditorSnapGridMm } from "@interior-design/editor-core";
import type {
  CanonicalHomeSnapshot,
  KnownAttribution,
  ModelOperationRequest,
} from "@interior-design/contracts";
import { useState } from "react";
import type { SyntheticEvent } from "react";

import { selectionProvenance, selectionType } from "./presentation";

interface EditorInspectorProps {
  readonly actorUserId: string;
  readonly editable: boolean;
  readonly onCommand: (operation: ModelOperationRequest) => void;
  readonly selection: CanonicalElementSelection | undefined;
  readonly snapGridMm: EditorSnapGridMm;
  readonly snapshot: CanonicalHomeSnapshot;
}

function integer(form: FormData, name: string): number {
  const value = Number(form.get(name));
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be an integer number of mm.`);
  return value;
}

function text(form: FormData, name: string): string {
  const entry = form.get(name);
  const value = typeof entry === "string" ? entry.trim() : "";
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function operationContext(reason: string) {
  return { clientOperationId: crypto.randomUUID(), reason };
}

function attribution(actorUserId: string): KnownAttribution {
  return createUserAttribution({ actorUserId, claimId: crypto.randomUUID() });
}

function value<T>(actorUserId: string, nextValue: T) {
  return attributedUserValue(nextValue, attribution(actorUserId));
}

function ErrorMessage({ message }: { readonly message: string | undefined }) {
  return message ? (
    <p className="editor-form-error" role="alert">
      {message}
    </p>
  ) : null;
}

interface CommandFormProps {
  readonly actorUserId: string;
  readonly onCommand: (operation: ModelOperationRequest) => void;
  readonly selection: CanonicalElementSelection;
  readonly snapGridMm: EditorSnapGridMm;
}

function WallTranslationForm({ actorUserId, onCommand, selection, snapGridMm }: CommandFormProps) {
  const [error, setError] = useState<string>();
  if (selection.element.elementType !== "wall") return null;

  function submit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>): void {
    event.preventDefault();
    try {
      const form = new FormData(event.currentTarget);
      const snapped = snapTranslationMm(
        { xMm: integer(form, "xMm"), yMm: integer(form, "yMm") },
        snapGridMm,
      );
      onCommand(
        buildTranslateWallOperation(operationContext(text(form, "reason")), {
          pathAttribution: attribution(actorUserId),
          translation: snapped,
          wallId: selection.id,
        }),
      );
      setError(undefined);
      event.currentTarget.reset();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The wall command is invalid.");
    }
  }

  return (
    <form className="editor-command-form" onSubmit={submit}>
      <h3>Translate wall</h3>
      <p>Values snap locally to {snapGridMm} mm; the command submits exact integer millimetres.</p>
      <div className="editor-form-grid editor-form-grid--two">
        <label>
          <span>X translation (mm)</span>
          <input defaultValue="0" inputMode="numeric" name="xMm" required step="1" type="number" />
        </label>
        <label>
          <span>Y translation (mm)</span>
          <input defaultValue="0" inputMode="numeric" name="yMm" required step="1" type="number" />
        </label>
      </div>
      <label>
        <span>Reason</span>
        <input
          defaultValue="Align wall from structured editor input"
          maxLength={500}
          name="reason"
          required
        />
      </label>
      <ErrorMessage message={error} />
      <button className="editor-secondary-action" type="submit">
        Add wall translation
      </button>
    </form>
  );
}

function OpeningForm({ actorUserId, onCommand, selection }: CommandFormProps) {
  const [error, setError] = useState<string>();
  if (selection.element.elementType !== "wall") return null;

  function submit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>): void {
    event.preventDefault();
    try {
      const form = new FormData(event.currentTarget);
      const kind = text(form, "kind") as "door" | "opening" | "window";
      const swing = kind === "door" ? "left" : "none";
      onCommand(
        buildInsertOpeningOperation(operationContext(text(form, "reason")), {
          opening: {
            elementType: "opening",
            heightMm: value(actorUserId, integer(form, "heightMm")),
            hostWallId: selection.id,
            id: crypto.randomUUID(),
            kind,
            name: value(actorUserId, text(form, "name")),
            offsetAlongHostMm: value(actorUserId, integer(form, "offsetAlongHostMm")),
            origin: attribution(actorUserId),
            sillHeightMm: value(actorUserId, integer(form, "sillHeightMm")),
            swing: value(actorUserId, swing),
            widthMm: value(actorUserId, integer(form, "widthMm")),
          },
        }),
      );
      setError(undefined);
      event.currentTarget.reset();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The opening command is invalid.");
    }
  }

  return (
    <form className="editor-command-form" onSubmit={submit}>
      <h3>Insert opening</h3>
      <div className="editor-form-grid editor-form-grid--two">
        <label>
          <span>Opening name</span>
          <input defaultValue="New opening" maxLength={160} name="name" required />
        </label>
        <label>
          <span>Kind</span>
          <select defaultValue="door" name="kind">
            <option value="door">Door</option>
            <option value="window">Window</option>
            <option value="opening">Opening</option>
          </select>
        </label>
        <label>
          <span>Offset along wall (mm)</span>
          <input
            defaultValue="1000"
            min="1"
            name="offsetAlongHostMm"
            required
            step="1"
            type="number"
          />
        </label>
        <label>
          <span>Width (mm)</span>
          <input defaultValue="900" min="1" name="widthMm" required step="1" type="number" />
        </label>
        <label>
          <span>Height (mm)</span>
          <input defaultValue="2100" min="1" name="heightMm" required step="1" type="number" />
        </label>
        <label>
          <span>Sill height (mm)</span>
          <input defaultValue="0" name="sillHeightMm" required step="1" type="number" />
        </label>
      </div>
      <label>
        <span>Reason</span>
        <input defaultValue="Insert measured opening" maxLength={500} name="reason" required />
      </label>
      <ErrorMessage message={error} />
      <button className="editor-secondary-action" type="submit">
        Add opening command
      </button>
    </form>
  );
}

function RenameSpaceForm({ actorUserId, onCommand, selection }: CommandFormProps) {
  const [error, setError] = useState<string>();
  if (selection.element.elementType !== "space") return null;

  function submit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>): void {
    event.preventDefault();
    try {
      const form = new FormData(event.currentTarget);
      onCommand(
        buildRenameSpaceOperation(operationContext(text(form, "reason")), {
          name: value(actorUserId, text(form, "name")),
          spaceId: selection.id,
        }),
      );
      setError(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The rename command is invalid.");
    }
  }

  return (
    <form className="editor-command-form" onSubmit={submit}>
      <h3>Rename space</h3>
      <label>
        <span>New name</span>
        <input defaultValue={selection.label} maxLength={160} name="name" required />
      </label>
      <label>
        <span>Reason</span>
        <input defaultValue="Correct room name" maxLength={500} name="reason" required />
      </label>
      <ErrorMessage message={error} />
      <button className="editor-secondary-action" type="submit">
        Add rename command
      </button>
    </form>
  );
}

interface CreateFormsProps {
  readonly actorUserId: string;
  readonly onCommand: (operation: ModelOperationRequest) => void;
  readonly snapshot: CanonicalHomeSnapshot;
}

function CreateLevelForm({ actorUserId, onCommand }: CreateFormsProps) {
  const [error, setError] = useState<string>();
  function submit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>): void {
    event.preventDefault();
    try {
      const form = new FormData(event.currentTarget);
      onCommand(
        buildCreateLevelOperation(operationContext(text(form, "reason")), {
          level: {
            elementType: "level",
            elevationMm: value(actorUserId, integer(form, "elevationMm")),
            id: crypto.randomUUID(),
            name: value(actorUserId, text(form, "name")),
            origin: attribution(actorUserId),
            storeyHeightMm: value(actorUserId, integer(form, "storeyHeightMm")),
          },
        }),
      );
      setError(undefined);
      event.currentTarget.reset();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The level command is invalid.");
    }
  }
  return (
    <form className="editor-command-form" onSubmit={submit}>
      <h3>Create level</h3>
      <div className="editor-form-grid editor-form-grid--two">
        <label>
          <span>Name</span>
          <input defaultValue="New level" maxLength={160} name="name" required />
        </label>
        <label>
          <span>Elevation (mm)</span>
          <input defaultValue="2800" name="elevationMm" required step="1" type="number" />
        </label>
        <label>
          <span>Storey height (mm)</span>
          <input
            defaultValue="2600"
            min="1"
            name="storeyHeightMm"
            required
            step="1"
            type="number"
          />
        </label>
      </div>
      <label>
        <span>Reason</span>
        <input
          defaultValue="Create level from structured input"
          maxLength={500}
          name="reason"
          required
        />
      </label>
      <ErrorMessage message={error} />
      <button className="editor-secondary-action" type="submit">
        Add level command
      </button>
    </form>
  );
}

function CreateWallForm({ actorUserId, onCommand, snapshot }: CreateFormsProps) {
  const [error, setError] = useState<string>();
  function submit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>): void {
    event.preventDefault();
    try {
      const form = new FormData(event.currentTarget);
      onCommand(
        buildCreateWallOperation(operationContext(text(form, "reason")), {
          wall: {
            alignment: "centre",
            baseOffsetMm: value(actorUserId, 0),
            elementType: "wall",
            heightMm: value(actorUserId, integer(form, "heightMm")),
            id: crypto.randomUUID(),
            levelId: text(form, "levelId"),
            name: value(actorUserId, text(form, "name")),
            origin: attribution(actorUserId),
            path: value(actorUserId, [
              { xMm: integer(form, "startX"), yMm: integer(form, "startY") },
              { xMm: integer(form, "endX"), yMm: integer(form, "endY") },
            ]),
            thicknessMm: value(actorUserId, integer(form, "thicknessMm")),
          },
        }),
      );
      setError(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The wall command is invalid.");
    }
  }
  return (
    <form className="editor-command-form" onSubmit={submit}>
      <h3>Create wall</h3>
      <div className="editor-form-grid editor-form-grid--two">
        <label>
          <span>Name</span>
          <input defaultValue="New wall" maxLength={160} name="name" required />
        </label>
        <label>
          <span>Level</span>
          <select name="levelId">
            {snapshot.elements.levels.map((level) => (
              <option key={level.id} value={level.id}>
                {level.name.knowledge === "known" ? level.name.value : level.id.slice(0, 8)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Start X (mm)</span>
          <input defaultValue="0" name="startX" required step="1" type="number" />
        </label>
        <label>
          <span>Start Y (mm)</span>
          <input defaultValue="0" name="startY" required step="1" type="number" />
        </label>
        <label>
          <span>End X (mm)</span>
          <input defaultValue="3000" name="endX" required step="1" type="number" />
        </label>
        <label>
          <span>End Y (mm)</span>
          <input defaultValue="0" name="endY" required step="1" type="number" />
        </label>
        <label>
          <span>Thickness (mm)</span>
          <input defaultValue="180" min="1" name="thicknessMm" required step="1" type="number" />
        </label>
        <label>
          <span>Height (mm)</span>
          <input defaultValue="2600" min="1" name="heightMm" required step="1" type="number" />
        </label>
      </div>
      <label>
        <span>Reason</span>
        <input
          defaultValue="Create wall from structured input"
          maxLength={500}
          name="reason"
          required
        />
      </label>
      <ErrorMessage message={error} />
      <button className="editor-secondary-action" type="submit">
        Add wall command
      </button>
    </form>
  );
}

function CreateSpaceForm({ actorUserId, onCommand, snapshot }: CreateFormsProps) {
  const [error, setError] = useState<string>();
  function submit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>): void {
    event.preventDefault();
    try {
      const form = new FormData(event.currentTarget);
      const x = integer(form, "xMm");
      const y = integer(form, "yMm");
      const width = integer(form, "widthMm");
      const depth = integer(form, "depthMm");
      onCommand(
        buildCreateSpaceOperation(operationContext(text(form, "reason")), {
          space: {
            boundary: value(actorUserId, [
              { xMm: x, yMm: y },
              { xMm: x + width, yMm: y },
              { xMm: x + width, yMm: y + depth },
              { xMm: x, yMm: y + depth },
            ]),
            boundedByElementIds: [],
            classification: value(actorUserId, text(form, "classification")),
            elementType: "space",
            id: crypto.randomUUID(),
            levelId: text(form, "levelId"),
            name: value(actorUserId, text(form, "name")),
            origin: attribution(actorUserId),
          },
        }),
      );
      setError(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The space command is invalid.");
    }
  }
  return (
    <form className="editor-command-form" onSubmit={submit}>
      <h3>Create rectangular space</h3>
      <div className="editor-form-grid editor-form-grid--two">
        <label>
          <span>Name</span>
          <input defaultValue="New space" maxLength={160} name="name" required />
        </label>
        <label>
          <span>Classification</span>
          <input defaultValue="room" maxLength={160} name="classification" required />
        </label>
        <label>
          <span>Level</span>
          <select name="levelId">
            {snapshot.elements.levels.map((level) => (
              <option key={level.id} value={level.id}>
                {level.name.knowledge === "known" ? level.name.value : level.id.slice(0, 8)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Origin X (mm)</span>
          <input defaultValue="0" name="xMm" required step="1" type="number" />
        </label>
        <label>
          <span>Origin Y (mm)</span>
          <input defaultValue="0" name="yMm" required step="1" type="number" />
        </label>
        <label>
          <span>Width (mm)</span>
          <input defaultValue="3000" min="1" name="widthMm" required step="1" type="number" />
        </label>
        <label>
          <span>Depth (mm)</span>
          <input defaultValue="3000" min="1" name="depthMm" required step="1" type="number" />
        </label>
      </div>
      <label>
        <span>Reason</span>
        <input
          defaultValue="Create space from structured input"
          maxLength={500}
          name="reason"
          required
        />
      </label>
      <ErrorMessage message={error} />
      <button className="editor-secondary-action" type="submit">
        Add space command
      </button>
    </form>
  );
}

function CorrectionForms({
  actorUserId,
  onCommand,
  selection,
}: Omit<CommandFormProps, "snapGridMm">) {
  const [error, setError] = useState<string>();
  const metadataFields =
    selection.element.elementType === "space" ? ["name", "classification"] : ["name"];
  const provenanceFields =
    selection.element.elementType === "wall"
      ? ["name", "path", "heightMm", "thicknessMm"]
      : selection.element.elementType === "space"
        ? ["name", "classification", "boundary"]
        : selection.element.elementType === "opening"
          ? ["name", "heightMm", "widthMm"]
          : ["name"];

  function submitMetadata(event: SyntheticEvent<HTMLFormElement, SubmitEvent>): void {
    event.preventDefault();
    try {
      const form = new FormData(event.currentTarget);
      onCommand(
        buildCorrectElementMetadataOperation(operationContext(text(form, "reason")), {
          target: {
            collection: selection.collection,
            elementId: selection.id,
            field: text(form, "field") as "classification" | "name",
          },
          value: value(actorUserId, text(form, "value")),
        }),
      );
      setError(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The metadata correction is invalid.");
    }
  }

  function submitProvenance(event: SyntheticEvent<HTMLFormElement, SubmitEvent>): void {
    event.preventDefault();
    try {
      const form = new FormData(event.currentTarget);
      const nextAttribution =
        text(form, "state") === "unknown"
          ? {
              claimId: crypto.randomUUID(),
              evidenceIds: [],
              method: {
                kind: "manual" as const,
                name: "Home Design Studio 2D editor",
                version: "c5-editor-core-v1",
              },
              reason: "not-observed" as const,
              state: "unknown" as const,
              verification: { status: "not-reviewed" as const },
            }
          : attribution(actorUserId);
      onCommand(
        buildCorrectElementProvenanceOperation(operationContext(text(form, "reason")), {
          attribution: nextAttribution,
          target: {
            collection: selection.collection,
            elementId: selection.id,
            field: text(form, "field") as
              | "boundary"
              | "classification"
              | "heightMm"
              | "name"
              | "path"
              | "thicknessMm"
              | "widthMm",
          },
        }),
      );
      setError(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The provenance correction is invalid.");
    }
  }

  return (
    <>
      <form className="editor-command-form" onSubmit={submitMetadata}>
        <h3>Correct metadata</h3>
        <div className="editor-form-grid editor-form-grid--two">
          <label>
            <span>Field</span>
            <select name="field">
              {metadataFields.map((field) => (
                <option key={field}>{field}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Corrected value</span>
            <input maxLength={160} name="value" required />
          </label>
        </div>
        <label>
          <span>Reason</span>
          <input defaultValue="Correct element metadata" maxLength={500} name="reason" required />
        </label>
        <ErrorMessage message={error} />
        <button className="editor-secondary-action" type="submit">
          Add metadata correction
        </button>
      </form>
      <form className="editor-command-form" onSubmit={submitProvenance}>
        <h3>Correct provenance</h3>
        <div className="editor-form-grid editor-form-grid--two">
          <label>
            <span>Field</span>
            <select name="field">
              {provenanceFields.map((field) => (
                <option key={field}>{field}</option>
              ))}
            </select>
          </label>
          <label>
            <span>State</span>
            <select name="state">
              <option value="user-asserted">User asserted</option>
              <option value="unknown">Unknown / not observed</option>
            </select>
          </label>
        </div>
        <label>
          <span>Reason</span>
          <input defaultValue="Correct element provenance" maxLength={500} name="reason" required />
        </label>
        <button className="editor-secondary-action" type="submit">
          Add provenance correction
        </button>
      </form>
    </>
  );
}

export function EditorInspector({
  actorUserId,
  editable,
  onCommand,
  selection,
  snapGridMm,
  snapshot,
}: EditorInspectorProps) {
  return (
    <aside className="editor-inspector" aria-labelledby="inspector-title">
      <header>
        <span>Inspector</span>
        <h2 id="inspector-title">{selection?.label ?? "Nothing selected"}</h2>
        <p>
          {selection
            ? `${selectionType(selection)} · ${selection.id}`
            : "Select an element from the plan or accessible list."}
        </p>
      </header>
      {selection ? <SelectionEvidence selection={selection} /> : null}
      {!editable ? (
        <div className="editor-readonly-note" role="note">
          <strong>Viewer access is read-only</strong>
          <span>
            You can inspect exact geometry, provenance, history and comparisons. Editing and restore
            controls are not available.
          </span>
        </div>
      ) : null}
      {editable && selection ? (
        <div className="editor-inspector__commands">
          <WallTranslationForm
            actorUserId={actorUserId}
            onCommand={onCommand}
            selection={selection}
            snapGridMm={snapGridMm}
          />
          <OpeningForm
            actorUserId={actorUserId}
            onCommand={onCommand}
            selection={selection}
            snapGridMm={snapGridMm}
          />
          <RenameSpaceForm
            actorUserId={actorUserId}
            onCommand={onCommand}
            selection={selection}
            snapGridMm={snapGridMm}
          />
          <details>
            <summary>Correction commands</summary>
            <CorrectionForms
              actorUserId={actorUserId}
              onCommand={onCommand}
              selection={selection}
            />
          </details>
        </div>
      ) : null}
      {editable ? (
        <details className="editor-create-commands">
          <summary>Create elements</summary>
          <p>
            These structured forms create typed C5 commands; they do not mutate the SVG directly.
          </p>
          <CreateLevelForm actorUserId={actorUserId} onCommand={onCommand} snapshot={snapshot} />
          <CreateWallForm actorUserId={actorUserId} onCommand={onCommand} snapshot={snapshot} />
          <CreateSpaceForm actorUserId={actorUserId} onCommand={onCommand} snapshot={snapshot} />
        </details>
      ) : null}
    </aside>
  );
}

function SelectionEvidence({ selection }: { readonly selection: CanonicalElementSelection }) {
  const provenance = selectionProvenance(selection);
  return (
    <section className="editor-provenance" aria-labelledby="provenance-title">
      <h3 id="provenance-title">Source and provenance</h3>
      <dl>
        <div>
          <dt>Origin</dt>
          <dd>{provenance.originState}</dd>
        </div>
        <div>
          <dt>Method</dt>
          <dd>{provenance.method}</dd>
        </div>
        <div>
          <dt>Version</dt>
          <dd>{provenance.methodVersion}</dd>
        </div>
        <div>
          <dt>Review</dt>
          <dd>{provenance.reviewed}</dd>
        </div>
      </dl>
      <details>
        <summary>Attributed fields ({provenance.fields.length})</summary>
        <ul>
          {provenance.fields.map((field) => (
            <li key={field.field}>
              <span>{field.field}</span>
              <strong>{field.state}</strong>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
