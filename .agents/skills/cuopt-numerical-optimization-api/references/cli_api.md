# cuOpt Numerical Optimization — CLI

Use `cuopt_cli` for existing MPS, QPS, or LP model files. Verify installed options with `cuopt_cli --help`.

```bash
cuopt_cli problem.mps
```

- Generate model files from a modeling library or validated model; do not hand-author formats from memory.
- Treat `cuopt_cli --help` as authoritative for supported extensions and flags.
- Check reported variable and constraint counts against the intended formulation.
- QP is beta, MINIMIZE-only, and continuous-only.
