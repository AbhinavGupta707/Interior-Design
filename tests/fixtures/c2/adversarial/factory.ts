import { createHash } from "node:crypto";

export type AdversarialFixtureId =
  | "codec-output-flood-metadata"
  | "exif-gps-jpeg"
  | "image-dimension-claim"
  | "malformed-mp4-box"
  | "mime-signature-mismatch"
  | "pdf-decompression-claim"
  | "pdf-page-count-claim"
  | "png-svg-polyglot"
  | "shell-metacharacter-name"
  | "svg-external-resource"
  | "svg-xxe"
  | "traversal-control-name"
  | "traversal-posix-name"
  | "traversal-windows-name"
  | "video-duration-claim";

export type AdversarialAttackClass =
  | "codec-metadata"
  | "control-character"
  | "decompression-bomb"
  | "extension-mime-confusion"
  | "external-resource"
  | "filename-shell-metacharacters"
  | "gps-privacy"
  | "image-bomb"
  | "output-flood"
  | "path-traversal"
  | "pdf-bomb"
  | "polyglot"
  | "svg-active-content"
  | "video-bomb"
  | "xxe";

export type FixtureEdgeExpectation = "accept-as-untrusted-hint" | "reject-request";

export interface AdversarialFixtureDefinition {
  readonly attackClasses: readonly AdversarialAttackClass[];
  readonly declaredMimeType:
    "application/pdf" | "image/jpeg" | "image/png" | "image/svg+xml" | "video/mp4";
  readonly edgeExpectation: FixtureEdgeExpectation;
  readonly fileName: string;
  readonly id: AdversarialFixtureId;
  readonly kind: "document" | "photograph" | "plan" | "video";
  readonly processingExpectation:
    | {
        readonly mode: "reject";
        readonly rejectionCodes: readonly (
          "malformed-media" | "resource-limit" | "signature-mismatch" | "unsupported-type"
        )[];
      }
    | {
        readonly mode: "reject-or-sanitise";
        readonly forbiddenPreviewMarkers: readonly string[];
        readonly rejectionCodes: readonly (
          "malformed-media" | "resource-limit" | "signature-mismatch" | "unsupported-type"
        )[];
      };
  readonly safetyNote: string;
}

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const onePixelJpeg = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EH//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EH//2Q==",
  "base64",
);

function minimalPdf(extraObject = ""): Buffer {
  return Buffer.from(
    `%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Count 1 /Kids [3 0 R] >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 1 1] >> endobj\n${extraObject}\ntrailer << /Root 1 0 R >>\n%%EOF\n`,
    "ascii",
  );
}

function pngWithClaimedDimensions(width: number, height: number): Buffer {
  const result = Buffer.from(onePixelPng);
  result.writeUInt32BE(width, 16);
  result.writeUInt32BE(height, 20);
  return result;
}

function mp4WithDurationClaim(durationMilliseconds: number): Buffer {
  const ftyp = Buffer.from([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x00, 0x00,
    0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x32,
  ]);
  const mvhd = Buffer.alloc(32);
  mvhd.writeUInt32BE(32, 0);
  mvhd.write("mvhd", 4, "ascii");
  mvhd.writeUInt32BE(1_000, 20);
  mvhd.writeUInt32BE(durationMilliseconds, 24);
  return Buffer.concat([ftyp, mvhd]);
}

function writeIfdEntry(
  target: Buffer,
  offset: number,
  tag: number,
  type: number,
  count: number,
  valueOrOffset: number | Buffer,
): void {
  target.writeUInt16LE(tag, offset);
  target.writeUInt16LE(type, offset + 2);
  target.writeUInt32LE(count, offset + 4);
  if (Buffer.isBuffer(valueOrOffset)) {
    valueOrOffset.copy(target, offset + 8, 0, 4);
  } else {
    target.writeUInt32LE(valueOrOffset, offset + 8);
  }
}

function jpegWithSyntheticGpsExif(): Buffer {
  const description = Buffer.from("SYNTHETIC_GPS_SENTINEL\0", "ascii");
  const tiff = Buffer.alloc(140 + description.length);
  tiff.write("II", 0, "ascii");
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);

  tiff.writeUInt16LE(2, 8);
  writeIfdEntry(tiff, 10, 0x010e, 2, description.length, 140);
  writeIfdEntry(tiff, 22, 0x8825, 4, 1, 38);
  tiff.writeUInt32LE(0, 34);

  tiff.writeUInt16LE(4, 38);
  writeIfdEntry(tiff, 40, 0x0001, 2, 2, Buffer.from([0x4e, 0x00, 0x00, 0x00]));
  writeIfdEntry(tiff, 52, 0x0002, 5, 3, 92);
  writeIfdEntry(tiff, 64, 0x0003, 2, 2, Buffer.from([0x45, 0x00, 0x00, 0x00]));
  writeIfdEntry(tiff, 76, 0x0004, 5, 3, 116);
  tiff.writeUInt32LE(0, 88);
  for (const offset of [92, 100, 108, 116, 124, 132]) {
    tiff.writeUInt32LE(0, offset);
    tiff.writeUInt32LE(1, offset + 4);
  }
  description.copy(tiff, 140);

  const payload = Buffer.concat([Buffer.from("Exif\0\0", "binary"), tiff]);
  const app1Header = Buffer.alloc(4);
  app1Header.writeUInt16BE(0xffe1, 0);
  app1Header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([
    onePixelJpeg.subarray(0, 2),
    app1Header,
    payload,
    onePixelJpeg.subarray(2),
  ]);
}

const bytesById: Readonly<Record<AdversarialFixtureId, () => Buffer>> = {
  "codec-output-flood-metadata": () =>
    Buffer.concat([
      mp4WithDurationClaim(1_000),
      Buffer.from("SYNTHETIC_CODEC_DIAGNOSTIC:".repeat(48), "ascii"),
    ]),
  "exif-gps-jpeg": jpegWithSyntheticGpsExif,
  "image-dimension-claim": () => pngWithClaimedDimensions(20_001, 20_001),
  "malformed-mp4-box": () =>
    Buffer.from([0x7f, 0xff, 0xff, 0xff, 0x6d, 0x64, 0x61, 0x74, 0x00, 0x00, 0x00]),
  "mime-signature-mismatch": () => minimalPdf(),
  "pdf-decompression-claim": () =>
    minimalPdf(
      "4 0 obj << /Length 2147483647 /Filter /FlateDecode >> stream\n0\nendstream\nendobj",
    ),
  "pdf-page-count-claim": () =>
    Buffer.from(
      "%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Count 501 /Kids [] >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n",
      "ascii",
    ),
  "png-svg-polyglot": () =>
    Buffer.concat([
      onePixelPng,
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><script data-synthetic="must-not-execute"/></svg>',
        "utf8",
      ),
    ]),
  "shell-metacharacter-name": () => Buffer.from(onePixelPng),
  "svg-external-resource": () =>
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://media-fetch.invalid/never" width="1" height="1"/></svg>',
      "utf8",
    ),
  "svg-xxe": () =>
    Buffer.from(
      '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY synthetic SYSTEM "file:///synthetic/nonexistent">]><svg xmlns="http://www.w3.org/2000/svg"><text>&synthetic;</text></svg>',
      "utf8",
    ),
  "traversal-control-name": () => Buffer.from(onePixelPng),
  "traversal-posix-name": () => Buffer.from(onePixelPng),
  "traversal-windows-name": () => Buffer.from(onePixelPng),
  "video-duration-claim": () => mp4WithDurationClaim(108_000_001),
};

export const adversarialFixtureDefinitions = Object.freeze([
  {
    attackClasses: ["codec-metadata", "output-flood"],
    declaredMimeType: "video/mp4",
    edgeExpectation: "accept-as-untrusted-hint",
    fileName: "diagnostic-flood.mp4",
    id: "codec-output-flood-metadata",
    kind: "video",
    processingExpectation: {
      mode: "reject",
      rejectionCodes: ["malformed-media", "resource-limit"],
    },
    safetyNote:
      "A sub-2 KiB malformed container repeats an inert diagnostic marker; it is not a large output payload.",
  },
  {
    attackClasses: ["gps-privacy"],
    declaredMimeType: "image/jpeg",
    edgeExpectation: "accept-as-untrusted-hint",
    fileName: "synthetic-gps.jpg",
    id: "exif-gps-jpeg",
    kind: "photograph",
    processingExpectation: {
      forbiddenPreviewMarkers: ["Exif\u0000\u0000", "SYNTHETIC_GPS_SENTINEL"],
      mode: "reject-or-sanitise",
      rejectionCodes: ["malformed-media", "unsupported-type"],
    },
    safetyNote:
      "The EXIF GPS coordinates are synthetic zero values and contain no person, address, or customer data.",
  },
  {
    attackClasses: ["image-bomb"],
    declaredMimeType: "image/png",
    edgeExpectation: "accept-as-untrusted-hint",
    fileName: "dimension-claim.png",
    id: "image-dimension-claim",
    kind: "photograph",
    processingExpectation: {
      mode: "reject",
      rejectionCodes: ["resource-limit", "malformed-media"],
    },
    safetyNote:
      "Only the tiny PNG header claims excessive dimensions; no expanded pixels are stored.",
  },
  {
    attackClasses: ["codec-metadata"],
    declaredMimeType: "video/mp4",
    edgeExpectation: "accept-as-untrusted-hint",
    fileName: "truncated-box.mp4",
    id: "malformed-mp4-box",
    kind: "video",
    processingExpectation: {
      mode: "reject",
      rejectionCodes: ["malformed-media", "resource-limit"],
    },
    safetyNote: "An eleven-byte MP4 box declares an impossible size and contains no codec payload.",
  },
  {
    attackClasses: ["extension-mime-confusion"],
    declaredMimeType: "image/jpeg",
    edgeExpectation: "accept-as-untrusted-hint",
    fileName: "looks-like-a-photo.jpg",
    id: "mime-signature-mismatch",
    kind: "photograph",
    processingExpectation: {
      mode: "reject",
      rejectionCodes: ["signature-mismatch"],
    },
    safetyNote: "A one-page synthetic PDF is deliberately declared as JPEG.",
  },
  {
    attackClasses: ["decompression-bomb", "pdf-bomb"],
    declaredMimeType: "application/pdf",
    edgeExpectation: "accept-as-untrusted-hint",
    fileName: "flate-length-claim.pdf",
    id: "pdf-decompression-claim",
    kind: "document",
    processingExpectation: {
      mode: "reject",
      rejectionCodes: ["resource-limit", "malformed-media"],
    },
    safetyNote:
      "The PDF stores only a tiny invalid stream and a large declared length; it is not a compressed bomb.",
  },
  {
    attackClasses: ["pdf-bomb"],
    declaredMimeType: "application/pdf",
    edgeExpectation: "accept-as-untrusted-hint",
    fileName: "page-count-claim.pdf",
    id: "pdf-page-count-claim",
    kind: "document",
    processingExpectation: {
      mode: "reject",
      rejectionCodes: ["resource-limit", "malformed-media"],
    },
    safetyNote: "A tiny page-tree dictionary claims 501 pages but contains no page payloads.",
  },
  {
    attackClasses: ["polyglot", "svg-active-content"],
    declaredMimeType: "image/png",
    edgeExpectation: "accept-as-untrusted-hint",
    fileName: "png-with-svg-trailer.png",
    id: "png-svg-polyglot",
    kind: "photograph",
    processingExpectation: {
      forbiddenPreviewMarkers: ["<svg", "<script", "must-not-execute"],
      mode: "reject-or-sanitise",
      rejectionCodes: ["signature-mismatch", "malformed-media"],
    },
    safetyNote:
      "A one-pixel PNG has a short inert SVG trailer; it is never rendered by the fixture pack.",
  },
  {
    attackClasses: ["filename-shell-metacharacters"],
    declaredMimeType: "image/png",
    edgeExpectation: "accept-as-untrusted-hint",
    fileName: "--output=$(synthetic-never-run);plan.png",
    id: "shell-metacharacter-name",
    kind: "plan",
    processingExpectation: {
      forbiddenPreviewMarkers: ["--output=", "$(synthetic-never-run)"],
      mode: "reject-or-sanitise",
      rejectionCodes: ["malformed-media"],
    },
    safetyNote:
      "The filename is data only; the token names no executable and the fixture creates no marker file.",
  },
  {
    attackClasses: ["external-resource", "svg-active-content"],
    declaredMimeType: "image/svg+xml",
    edgeExpectation: "accept-as-untrusted-hint",
    fileName: "external-resource.svg",
    id: "svg-external-resource",
    kind: "plan",
    processingExpectation: {
      forbiddenPreviewMarkers: ["<svg", "media-fetch.invalid", "<image"],
      mode: "reject-or-sanitise",
      rejectionCodes: ["malformed-media", "unsupported-type"],
    },
    safetyNote:
      "The only remote hostname uses the reserved .invalid TLD and must never be fetched.",
  },
  {
    attackClasses: ["svg-active-content", "xxe"],
    declaredMimeType: "image/svg+xml",
    edgeExpectation: "accept-as-untrusted-hint",
    fileName: "external-entity.svg",
    id: "svg-xxe",
    kind: "plan",
    processingExpectation: {
      forbiddenPreviewMarkers: ["<!DOCTYPE", "<!ENTITY", "file:///synthetic/nonexistent"],
      mode: "reject-or-sanitise",
      rejectionCodes: ["malformed-media", "unsupported-type"],
    },
    safetyNote:
      "The entity targets an intentionally nonexistent synthetic path and contains no local data.",
  },
  {
    attackClasses: ["control-character", "path-traversal"],
    declaredMimeType: "application/pdf",
    edgeExpectation: "reject-request",
    fileName: "plan\u0000.pdf",
    id: "traversal-control-name",
    kind: "plan",
    processingExpectation: {
      mode: "reject",
      rejectionCodes: ["malformed-media"],
    },
    safetyNote:
      "The NUL appears only inside a JavaScript string and is never written as a filesystem name.",
  },
  {
    attackClasses: ["path-traversal"],
    declaredMimeType: "application/pdf",
    edgeExpectation: "reject-request",
    fileName: "../synthetic/plan.pdf",
    id: "traversal-posix-name",
    kind: "plan",
    processingExpectation: {
      mode: "reject",
      rejectionCodes: ["malformed-media"],
    },
    safetyNote: "The traversal token remains in memory and is never materialized as a path.",
  },
  {
    attackClasses: ["path-traversal"],
    declaredMimeType: "application/pdf",
    edgeExpectation: "reject-request",
    fileName: "..\\synthetic\\plan.pdf",
    id: "traversal-windows-name",
    kind: "plan",
    processingExpectation: {
      mode: "reject",
      rejectionCodes: ["malformed-media"],
    },
    safetyNote: "The traversal token remains in memory and is never materialized as a path.",
  },
  {
    attackClasses: ["codec-metadata", "video-bomb"],
    declaredMimeType: "video/mp4",
    edgeExpectation: "accept-as-untrusted-hint",
    fileName: "duration-claim.mp4",
    id: "video-duration-claim",
    kind: "video",
    processingExpectation: {
      mode: "reject",
      rejectionCodes: ["resource-limit", "malformed-media"],
    },
    safetyNote:
      "A 56-byte metadata-only MP4 claims a duration above the frozen schema limit; it has no frames.",
  },
] as const satisfies readonly AdversarialFixtureDefinition[]);

export function createAdversarialFixture(id: AdversarialFixtureId): Buffer {
  return Buffer.from(bytesById[id]());
}

export function fixtureSha256(id: AdversarialFixtureId): string {
  return createHash("sha256").update(createAdversarialFixture(id)).digest("hex");
}

export function fixtureDefinition(id: AdversarialFixtureId): AdversarialFixtureDefinition {
  const definition = adversarialFixtureDefinitions.find((candidate) => candidate.id === id);
  if (definition === undefined) {
    throw new Error(`Unknown synthetic C2 fixture: ${id}`);
  }
  return definition;
}
