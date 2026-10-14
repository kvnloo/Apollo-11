# Apollo-11 QMP follow-up: independent verification

Published production candidate: fe2d800f4e8bba423ce07879e3a9ad556002492c.
Original existing carrier: ThePrimeagen/Apollo-11#76, head 3a19a8c95c4a8de5c42338274986352d2383db7e.

This evidence branch does not advance the production-candidate ref or the existing upstream PR. Original client authors Cursor Agent and ThePrimeagen retain their exact signed/coauthored commit ancestry. Hermes reconstructed the reported concurrency/process-exit repair and supplied test-first corrections and independent review. The named original historical archive/checksum was NOT_RECOVERED; this is not represented as byte-identical recovery of it.

## Final scoped review

- Five frozen real-process/Unix-socket regressions: 5/5 PASS.
- Ten supplemental public-API cases: 10/10 PASS.
- Eight additional independent contract controls: 8/8 PASS.
- Six unchanged older reviewer controls: 4 PASS; 2 FAIL assertion mismatches retained. They expect continued success after malformed idle input. Separate tests establish the intended fail-closed behavior: host survives, later requests reject normally, stop completes, child reaped, timers cleared. Those original assertions were not weakened or relabelled PASS.
- Strict TypeScript, no-classes, security, original ancestry and protected-source integrity checks: PASS.
- Real QEMU/qemu-img: NOT_RUN; unavailable in the tested environment. Owned Node child processes over actual Unix sockets are not claimed as QEMU integration.

The earlier malformed/null-frame crash, unbounded failed-start SIGTERM cleanup, and immediate stop/failed-spawn race are repaired. Silent-peer limits, concurrent-start ownership and escalation for ordinary stop after successful startup remain outside scope; ordinary stop still relies on SIGTERM.

The machine verdict binds every cohort and result to its actual head/tree. Operator paths are normalized in this public copy; complete raw commands, probes, logs, restoration bundles and original hashes remain at /workspace/zer0/data/operations/primeagen-wave/20261013/apollo-final-review on the operator host. No production fixes were made by the final reviewer.

## Apply or inspect, without duplicating the owner PR

Fetch `fix/qmp-review-followup-20261013` from https://github.com/kvnloo/Apollo-11.git. Compare its exact production commit against the original PR head, limiting the delta to qemu/client.ts. Do not open a competing upstream PR or blindly merge the owner's unlanded feature into master.

No upstream comment, PR modification, merge, formal approval or authorization-system change was performed. Origin evidence posting remains a separate operation-specific gate. This packet is AI-assisted verification, not maintainer signoff or hosted-CI acceptance.
