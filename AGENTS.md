# Explain tests through their purpose

For every new or materially changed test, create or update one Markdown lesson under `explained-tests/`, mirroring its path beneath `tests/`. Keep the folder and per-file indexes current. This requirement applies to tests and their helpers, not unrelated product code.

The user wants to understand what a test proves quickly. Begin with the driver's experience: what they are doing, what could go wrong for them, and what behaviour we want. Backtrack from that experience to the work inside the browser, then to the called function, concrete inputs, calculations and assertions. Define FPS, tick, duration, worker, snapshot and other unfamiliar concepts in plain language before using them. State precisely which small part of the user-facing goal this test actually checks; do not imply the whole experience is verified by a helper test.

Distinguish mocked inputs from real browser or hardware operations. Explain which values are supplied by the test, which results the function must produce, and what the test leaves unverified. For missing implementations, describe the expected contract and label dry runs as expectations.

Teach gradually rather than compressing the reasoning. There is no word limit: use as many small steps as the reader needs. Before any calculation, define every quantity, its units and where its number comes from. Show the arithmetic for one step, then repeated steps, then the total. For functions and callbacks, explain who calls whom, what arguments are passed, when the callback runs, what it changes and what is returned. Do not jump from the driver's experience straight to unfamiliar terms or equations.

Introduce exact test code only after the concepts and worked example. Trace its meaningful calls and assertions in execution order, with concrete intermediate values. Familiar imports and punctuation do not need repeated tutorials unless asked. Keep the explanation focused on this test rather than substituting generic syntax commentary for understanding. Link the source with a verified line number.

Explain shared helpers briefly and link them where useful. Do not invent their behaviour. Update lessons when test expectations or implementation boundaries change. Preserve test code when only revising explanations.

Report new test purposes and link their lessons in the user-facing change report. Never present a mocked dry run as measured performance or a passed browser integration test.
