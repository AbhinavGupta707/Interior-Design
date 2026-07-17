# Inference worker

This service contains provider-free Python 3.12 inference boundaries. C6 exposes the plan parser as
`python -m inference_worker.plan_parser` with `services/inference-worker/src` on `PYTHONPATH`.

The worker accepts one bounded JSON envelope on stdin, writes one strict proposal or abstention JSON
object on stdout for every valid frozen request, and never requires a key, network connection, paid
provider, model download, or GPU. See
`docs/runbooks/development/c6-inference-worker.md` for the exact normalized input and operating
contract.
