---
name: cuopt-numerical-optimization-api
version: "26.12.00"
description: LP, MILP, and QP (beta) with cuOpt — Python, C, and CLI. Use when the user is solving LP, MILP, or QP with any cuOpt interface.
license: Apache-2.0
metadata:
  author: NVIDIA cuOpt Team
  tags: [cuopt, linear-programming, milp, qp, python, c-api, cli]
---

# cuOpt Numerical Optimization API

Model and solve LP, MILP, and QP problems using NVIDIA cuOpt's GPU-accelerated solver.

## Interface selection
| Interface | When to use | Reference |
|---|---|---|
| Python | Python applications | references/python_api.md |
| C / C++ | Native applications | references/c_api.md |
| CLI | Existing MPS/QPS/LP files | references/cli_api.md |

If the interface is unclear, ask before writing interface-specific code. If the user already uses AMPL, GAMS/GAMSPy, PuLP, JuMP, Pyomo, or CVXPY, prefer its cuOpt solver integration over porting the model.

## Choose the formulation
| Objective | Variables | Formulation |
|---|---|---|
| Linear | Continuous | LP |
| Linear | Some integer/binary | MILP |
| Quadratic | Continuous only | QP (beta) |

Prefer LP when fractional values are meaningful. Use MILP for counts and yes/no decisions. Use QP for genuinely quadratic objectives such as variance or squared error.

## QP rules
- MINIMIZE only. For maximization, minimize the negated objective and negate the reported objective value.
- Continuous variables only; integer QP is unsupported.
- The quadratic matrix should be positive semidefinite for a convex, well-posed problem.
- QP is beta and its API may evolve.

## Dual values
Duals and reduced costs are available for LP and QP only, not MILP. Dual values for models with quadratic constraints may be NaN.

## Modeling and correctness
- Confirm objective direction, units, bounds, integrality, and every constraint before solving.
- Distinguish infeasible, unbounded, time-limited, feasible, and optimal results.
- Never label a feasible solution as proven optimal.
- Validate returned values against the original constraints and report solver status, objective, and any exposed optimality gap.
- Never invent a solver result. If cuOpt is not installed or reachable, provide code and state that execution has not occurred.
