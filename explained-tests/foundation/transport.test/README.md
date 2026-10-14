# transport lessons

Start with a car update reaching the display. Learn how the receiver recognises old results, then how reusable storage is borrowed, transferred and returned. The tests call helpers directly; they do not create a browser worker or exchange multiplayer messages.

Each lesson increases detail gradually: driver experience → the missing background → one calculation → repeated calculations → exact test code → the calls, recorded values and assertions → limits of the proof.

- [transport: only the newest snapshot becomes the display state](01-latest-snapshot.md)
- [transport: a slow consumer cannot cause unbounded snapshot allocation](02-bounded-pool.md)
- [transport: a returned snapshot buffer can be reused without another allocation](03-reuse-transferred-buffer.md)
- [transport: the same buffer cannot be returned to the pool twice](04-reject-double-return.md)
- [transport: input must carry a valid future tick and bounded control values](05-validate-ticked-input.md)
