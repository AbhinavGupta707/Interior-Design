# C2 adversarial fixture policy

This directory contains deterministic generators only. Every generated payload is synthetic, remains below 4 KiB, and contains no malware, customer file, real address, credential, or personal location.

The `factory.ts` cases use malformed headers or exaggerated metadata claims instead of real decompression, image, PDF, or video bombs. External SVG references use the reserved `.invalid` top-level domain or an intentionally nonexistent synthetic local path. Tests must never render the SVG/XML payloads or follow their references.

The fixtures are intended for disposable local C2 environments. Their declarations, names, extensions, and metadata are hostile hints; source object keys must always be opaque and server-generated.
