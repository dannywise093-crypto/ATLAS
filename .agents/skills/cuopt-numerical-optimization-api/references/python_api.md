# cuOpt Numerical Optimization — Python API

```python
from cuopt.linear_programming.problem import Problem, CONTINUOUS, INTEGER, MINIMIZE, MAXIMIZE
from cuopt.linear_programming.solver_settings import SolverSettings
```

## LP
```python
problem = Problem("MyLP")
x = problem.addVariable(lb=0, vtype=CONTINUOUS, name="x")
y = problem.addVariable(lb=0, vtype=CONTINUOUS, name="y")
problem.addConstraint(2*x + 3*y <= 120, name="resource_a")
problem.addConstraint(4*x + 2*y <= 100, name="resource_b")
problem.setObjective(40*x + 30*y, sense=MAXIMIZE)
settings = SolverSettings()
settings.set_parameter("time_limit", 60)
problem.solve(settings)
if problem.Status.name in ["Optimal", "PrimalFeasible"]:
    print(problem.ObjValue, x.getValue(), y.getValue())
```

## MILP
```python
problem = Problem("FacilityLocation")
open_facility = problem.addVariable(lb=0, ub=1, vtype=INTEGER, name="open")
production = problem.addVariable(lb=0, vtype=CONTINUOUS, name="production")
problem.addConstraint(production <= 1000 * open_facility, name="link")
problem.setObjective(500*open_facility + 2*production, sense=MINIMIZE)
settings = SolverSettings()
settings.set_parameter("time_limit", 120)
settings.set_parameter("mip_relative_gap", 0.01)
problem.solve(settings)
if problem.Status.name in ["Optimal", "FeasibleFound"]:
    print(open_facility.getValue() > 0.5, production.getValue())
```

## Status and settings
Statuses use PascalCase, e.g. LP/QP `Optimal`, `PrimalFeasible`, `PrimalInfeasible`, `DualInfeasible`, `TimeLimit`; MILP `Optimal`, `FeasibleFound`, `Infeasible`, `Unbounded`, `TimeLimit`. Check the installed version for the complete set.
```python
settings = SolverSettings()
settings.set_parameter("time_limit", 60)
settings.set_parameter("mip_relative_gap", 0.01)
settings.set_parameter("log_to_console", 1)
```
Duals/reduced costs are for LP/QP only. Consult NVIDIA's current API reference for QP methods and version-specific details.
