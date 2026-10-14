# What a test proves

A test supplies inputs, calls a function and checks the result. Each assertion is an expectation: “this value should equal that value”. A mismatch fails the test.

Mocked inputs let us test a decision under conditions we choose. In these capability tests, `supported()` returns an object of fake checks that always report success. They do not inspect the laptop.

For example: pretend WebGL 2 works and WebGPU does not. Ask `detectCapabilities` whether startup is allowed. Expect yes through the compatibility path.

To test actual compatibility, we also need a browser check that obtains a real graphics context/device. Mocked decision tests cannot replace it.
