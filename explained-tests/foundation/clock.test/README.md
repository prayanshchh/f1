# clock lessons

Start with one gap between pictures. Learn what time must be calculated, divide it into smaller periods, then trace the instructions passed to the movement callback. After that, expand the idea to a ten-second run. Movement scheduling happens inside the browser; these tests do not render a real car.

Recommended first lesson: [one gap, four movement calculations](02-fixed-ticks-and-duration.md). Then read [the ten-second comparison](01-render-rate-independent-motion.md).

Each lesson increases detail gradually: driver experience → the missing background → one calculation → repeated calculations → exact test code → the calls, recorded values and assertions → limits of the proof.

- [clock: ten seconds of ticked input has the same result at 30, 60 and 144 FPS](01-render-rate-independent-motion.md)
- [clock: every update receives the fixed duration and a consecutive tick](02-fixed-ticks-and-duration.md)
- [clock: display blending has a fraction between zero and one](03-half-tick-blending.md)
- [clock: a five-second solo interruption cannot cause unbounded catch-up](04-bounded-solo-catch-up.md)
- [clock: a connected simulation flags interruption instead of silently discarding time](05-connected-interruption.md)
- [clock: paused solo simulation ignores elapsed hidden-tab time](06-pause-and-resume.md)
- [clock: invalid time cannot corrupt simulation state](07-reject-invalid-time.md)
