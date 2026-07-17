# Spatial worker

The spatial worker runs bounded, untrusted-media inspection and later spatial processing outside the HTTP request path. C2 begins with the provider-free ingestion pipeline. It consumes the shared `c2-ingest-v1` command contract and writes only derived or quarantine artifacts; source evidence is immutable.

No customer media belongs in Git. Development uses synthetic fixtures and the loopback-only S3-compatible object store.
