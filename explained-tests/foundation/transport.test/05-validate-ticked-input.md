# Check a driving command's controls and target time before using it

## 1. Start with pressing the controls

You press the accelerator, brake or steering control. The movement calculation eventually needs those choices in a numeric form, attached to the update where they should apply. A malformed command should not be treated as normal input.

This test checks that validation decision. It does not read keys, send a message or apply the controls to a car.

## 2. Explain the control numbers

Throttle and brake are fractions from 0 to 1: 0 means none, 1 means full input and 0.5 means half. Steering ranges from -1 to 1; zero is centred, negative and positive represent opposite directions. This validation case does not define which sign is left.

Thus throttle=0.5, brake=0 and steering=-0.25 describe half throttle, no brake and quarter steering toward one side. Values such as throttle=2 would mean twice the agreed full scale and must be rejected.

## 3. Explain when the command is intended to apply

A movement update is one calculation step, called a tick. Numbering updates lets a command identify a particular future step rather than ambiguously saying “whenever this message happens to arrive”.

The test says the current tick is 10 and permits an eight-tick look-ahead. Under the agreed initial contract, future whole ticks up to 10+8=18 are in that window. The test does not check every boundary of that window.

The valid command targets tick 12. Its lead is 12−10=2 ticks, within the allowed eight. At a 120 Hz schedule, two ticks would represent 2/120=1/60 second; the validator itself only receives tick numbers and does not need that conversion.

## 4. Introduce the validator's responsibility

`validateInput(command,context)` receives the proposed controls and timing context. It should return an object with ok=true for acceptance, or ok=false and a reason for rejection. It should not apply the command during validation.

The test constructs all commands itself. The original valid command is reused as a baseline; each invalid object changes just one field while keeping the others.

## The exact test, after the example

```javascript
test('transport: input must carry a valid future tick and bounded control values', async () => {
  const { validateInput } = await loadContract('transport');
  const context = { currentTick: 10, maxLeadTicks: 8 };
  const valid = { tick: 12, throttle: 0.5, brake: 0, steering: -0.25 };
  assert.equal(validateInput(valid, context).ok, true);
  for (const invalid of [
    { ...valid, tick: 9 }, { ...valid, tick: 100 }, { ...valid, tick: 12.5 },
    { ...valid, throttle: 2 }, { ...valid, brake: -1 }, { ...valid, steering: NaN },
  ]) {
    const result = validateInput(invalid, context);
    assert.equal(result.ok, false);
    assert.match(result.reason, /\S/);
  }
});
```

## 5. Trace the valid case, then one change at a time

The first call receives tick=12, throttle=0.5, brake=0 and steering=-0.25, with currentTick=10 and maxLeadTicks=8. Its ok field must be true.

Then the loop checks six new command objects:

| Changed field | Calculation or interpretation | Expected outcome |
|---|---|---|
| tick=9 | 9<10: its target has already passed | Reject |
| tick=100 | 100−10=90: beyond the eight-tick allowance | Reject |
| tick=12.5 | It identifies a fraction of an update, not a whole numbered step | Reject |
| throttle=2 | Greater than full-scale value 1 | Reject |
| brake=-1 | Below the minimum value 0 | Reject |
| steering=NaN | Not-a-Number supplies no usable finite steering value | Reject |

## 6. Follow the loop's checks

For each object, the call stores the returned validation result under result. `assert.equal(result.ok,false)` requires rejection. Accepting even one altered command fails.

`assert.match(result.reason,/\S/)` requires an explanation containing at least one non-whitespace character. An empty string or only spaces fails; the test does not require the reason to name the exact offending field.

The six cases each change one field so failure is easy to locate. Missing fields, every edge value, real message arrival and actual application on tick 12 remain outside these assertions.


## What happens today

The application module is missing. The test first calls [loadContract](../contracts.md) to load it; that call fails, so the later function calls and assertions do not execute. The worked result above is the expectation the test specifies, not an executed application result.

Source: [tests/foundation/transport.test.mjs](/Users/prayanshchhablani/work/f1/tests/foundation/transport.test.mjs:48).
