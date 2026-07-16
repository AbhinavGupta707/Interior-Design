# Research corpus migration note

The supplied research dossier currently remains intact under `ai_native_architecture_blue_sky/` to preserve hashes, relative references and user provenance during repository activation.

A later orchestrator-owned migration may move it to `docs/research/blue-sky-dossier/` after:

1. references and manifests are rewritten;
2. hashes are revalidated;
3. implementation documents are separated from immutable source research; and
4. one migration commit records the old and new paths.

No worker may reorganise or delete the corpus opportunistically.
