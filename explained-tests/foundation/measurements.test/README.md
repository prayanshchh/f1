# measurements lessons

Start with a pause you might feel while driving. Learn what a reading measures, where each supplied number comes from, and how the report computes its conclusions. The readings in these tests are synthetic; there is no device benchmark.

Each lesson increases detail gradually: driver experience → the missing background → one calculation → repeated calculations → exact test code → the calls, recorded values and assertions → limits of the proof.

- [measurements: an isolated stall remains visible in the report](01-preserve-slow-frame.md)
- [measurements: CPU costs stay distinct from frame intervals and GPU costs](02-separate-measurement-scopes.md)
- [measurements: unavailable GPU and memory readings are null, not zero](03-unavailable-is-null.md)
- [measurements: empty samples cannot produce a successful benchmark](04-reject-empty-benchmark.md)
- [measurements: JSON export preserves the route and measurement scope](05-export-metadata.md)
