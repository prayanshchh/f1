# Explained tests

The clock, measurements and transport lessons are gradual teaching walkthroughs. They begin with what the driver sees, introduce each unfamiliar idea before using it, derive every number with its units, then follow the exact test code and assertions. There is no length cap and no jump straight from the driving example to a formula.

Movement calculations and rendering happen locally in the browser. These documents explain expected contracts; the missing application implementations still prevent the foundation tests from reaching their assertions.

For the timing question, start with [movement between pictures](foundation/clock.test/02-fixed-ticks-and-duration.md).

For compatibility, start with [WebGL fallback](foundation/capabilities.test/01-webgl-fallback.md). Its inputs are mocked: it tests the startup decision, not real GPU support. [Mocked versus real checks](basics.md) explains that distinction briefly.

The 23 foundation implementations are still missing, so their dry runs are expectations. The separate platform transfer test passes locally in Node. [loadContract](foundation/contracts.md) explains why the others currently stop before their assertions.

## Lessons

- [capabilities: 6 cases](foundation/capabilities.test/README.md)
- [measurements: 5 cases](foundation/measurements.test/README.md)
- [clock: 7 cases](foundation/clock.test/README.md)
- [transport: 5 cases](foundation/transport.test/README.md)
- [platform: 1 cases](platform.test/README.md)

Each case keeps its existing path. Test code is unchanged. [Project instructions](/Users/prayanshchhablani/work/f1/AGENTS.md) now require short conceptual explanations and concrete dry runs, without repeated syntax commentary.
