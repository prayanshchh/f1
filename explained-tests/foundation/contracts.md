# How a test obtains the function it wants to check

Before testing the clock, report builder or buffer manager, the test needs to load the file that will provide it. That is loadContract's only job; it does not calculate movement, measure performance or manage buffers.

Follow the clock example:

1. The test calls `loadContract('clock')`. The word clock chooses the file, not a current time reading.
2. The helper builds the address `src/foundation/clock.mjs`, relative to the repository containing the helper.
3. It tries to import that file. Importing a module means obtaining its exported functions and values.
4. If successful, it returns a module object. The test takes `createFixedStepClock` from that object. It then calls the factory to create an independent clock and passes its recording callback into that clock.
5. Today the file is absent. The helper raises “Foundation contract not implemented yet”, so the callback stops before the factory, movement recording or assertions.

The loader similarly receives measurements or transport to select those modules. It rewrites only an import error naming the exact absent target. Other import failures are preserved, so a missing dependency inside an existing module is not wrongly called a missing target.

The lessons' worked examples describe what the later assertions expect after implementation. They are not recordings of a currently working application.

Source: [contracts.mjs](/Users/prayanshchhablani/work/f1/tests/foundation/contracts.mjs:3).
