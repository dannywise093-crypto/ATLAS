# cuOpt Numerical Optimization — C API

Headers:
```c
#include <cuopt/mathematical_optimization/cuopt_c.h>
#include <cuopt/mathematical_optimization/constants.h>
```

Typical sequence:
1. Create a ranged problem using a CSR constraint matrix and variable types.
2. Create solver settings and set documented parameters.
3. Call `cuOptSolve`.
4. Read objective and primal values; read duals for LP/QP only.
5. Destroy problem, settings, and solution resources.

Use `cuOptSetFloatParameter` for time limits/tolerances and `cuOptSetIntegerParameter` for integer-valued settings. Confirm exact symbols and constants against the installed headers.

QP is beta, MINIMIZE-only, continuous-only, and should use a positive-semidefinite quadratic matrix. Check every API return code, distinguish API status from solver status, validate CSR offsets and array sizes, and release all resources on success and error paths. Consult NVIDIA's current C API reference for exact signatures.
