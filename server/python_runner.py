"""Bounded Python runner for ATLAS.

This is a restricted subprocess runner, not a hardened multi-tenant security
boundary. See docs/PYTHON_EXECUTION_SECURITY.md before public deployment.
"""
from __future__ import annotations

import ast
import os
import subprocess
import sys
import tempfile
import textwrap
import time
from dataclasses import dataclass
from pathlib import Path

MAX_SOURCE_CHARS = 20_000
MAX_OUTPUT_CHARS = 20_000
TIME_LIMIT_SECONDS = 5
MEMORY_LIMIT_BYTES = 256 * 1024 * 1024
ALLOWED_IMPORTS = {
    "math", "statistics", "decimal", "fractions", "collections",
    "itertools", "functools", "operator", "re", "string", "datetime",
    "unittest",
}
BLOCKED_NAMES = {
    "eval", "exec", "compile", "open", "input", "globals", "locals",
    "vars", "getattr", "setattr", "delattr", "breakpoint", "help",
    "memoryview", "__import__",
}


class CodeRejected(ValueError):
    """Raised when source violates the runner's restricted language policy."""


@dataclass
class ExecutionResult:
    stdout: str
    stderr: str
    exit_code: int
    duration_ms: int
    timed_out: bool = False

    @property
    def passed(self) -> bool:
        return self.exit_code == 0 and not self.timed_out


class _Policy(ast.NodeVisitor):
    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            if alias.name.split(".")[0] not in ALLOWED_IMPORTS:
                raise CodeRejected(f"Import is not allowed: {alias.name}")
        self.generic_visit(node)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        if not node.module or node.module.split(".")[0] not in ALLOWED_IMPORTS:
            raise CodeRejected(f"Import is not allowed: {node.module or 'relative import'}")
        self.generic_visit(node)

    def visit_Name(self, node: ast.Name) -> None:
        if node.id in BLOCKED_NAMES or node.id.startswith("__"):
            raise CodeRejected(f"Use of {node.id!r} is not allowed.")
        self.generic_visit(node)

    def visit_Attribute(self, node: ast.Attribute) -> None:
        if node.attr.startswith("__"):
            raise CodeRejected("Dunder attribute access is not allowed.")
        self.generic_visit(node)


def validate_source(source: str) -> None:
    if not isinstance(source, str) or not source.strip():
        raise CodeRejected("Python source code is required.")
    if len(source) > MAX_SOURCE_CHARS:
        raise CodeRejected(f"Code exceeds the {MAX_SOURCE_CHARS}-character limit.")
    try:
        tree = ast.parse(source, mode="exec")
    except SyntaxError as exc:
        raise CodeRejected(f"Python syntax error on line {exc.lineno}: {exc.msg}") from exc
    _Policy().visit(tree)


_CHILD = r"""
import builtins
import sys
import traceback
source = sys.stdin.read()
allowed = {
    "abs", "all", "any", "bool", "callable", "chr", "dict", "divmod",
    "enumerate", "filter", "float", "format", "frozenset", "hash", "hex",
    "int", "isinstance", "issubclass", "iter", "len", "list", "map",
    "max", "min", "next", "oct", "ord", "pow", "print", "range", "repr",
    "reversed", "round", "set", "slice", "sorted", "str", "sum", "tuple",
    "type", "object", "super", "zip", "Exception", "TypeError", "ValueError", "RuntimeError",
    "AssertionError", "KeyError", "IndexError", "StopIteration",
}
safe_builtins = {name: getattr(builtins, name) for name in allowed}
safe_builtins["__build_class__"] = builtins.__build_class__
real_import = builtins.__import__
allowed_modules = {
    "math", "statistics", "decimal", "fractions", "collections",
    "itertools", "functools", "operator", "re", "string", "datetime",
    "unittest",
}
def safe_import(name, globals=None, locals=None, fromlist=(), level=0):
    if level or name.split(".")[0] not in allowed_modules:
        raise ImportError("Import is not allowed: " + name)
    return real_import(name, globals, locals, fromlist, level)
safe_builtins["__import__"] = safe_import

class LimitedWriter:
    encoding = "utf-8"
    def __init__(self, limit):
        self.limit = limit
        self.parts = []
        self.size = 0
    def write(self, value):
        value = str(value)
        remaining = self.limit - self.size
        if remaining > 0:
            piece = value[:remaining]
            self.parts.append(piece)
            self.size += len(piece)
        return len(value)
    def getvalue(self):
        return "".join(self.parts)
    def flush(self):
        pass
    def isatty(self):
        return False

real_stdout, real_stderr = sys.stdout, sys.stderr
sys.stdout, sys.stderr = LimitedWriter(20000), LimitedWriter(20000)
main_module = types.ModuleType("__main__")\nsys.modules["__main__"] = main_module\nnamespace = main_module.__dict__\nnamespace["__builtins__"] = safe_builtins
exit_code = 0
try:
    exec(compile(source, "<atlas-user-code>", "exec"), namespace, namespace)
except BaseException:
    traceback.print_exc(file=sys.stderr)
    exit_code = 1
finally:
    real_stdout.write(sys.stdout.getvalue())
    real_stderr.write(sys.stderr.getvalue())
sys.exit(exit_code)
"""


def _limits() -> None:
    if os.name != "posix":
        return
    try:
        import resource
        resource.setrlimit(resource.RLIMIT_CPU, (10, 10))
        resource.setrlimit(resource.RLIMIT_AS, (MEMORY_LIMIT_BYTES, MEMORY_LIMIT_BYTES))
        resource.setrlimit(resource.RLIMIT_FSIZE, (1_000_000, 1_000_000))
        resource.setrlimit(resource.RLIMIT_NOFILE, (32, 32))
        if hasattr(resource, "RLIMIT_NPROC"):
            resource.setrlimit(resource.RLIMIT_NPROC, (16, 16))
    except (ImportError, OSError, ValueError):
        # The outer wall-clock timeout remains enforced if a limit is unavailable.
        pass


def execute_python(source: str) -> ExecutionResult:
    validate_source(source)
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix="atlas-run-") as workdir:
        os.chmod(workdir, 0o700)
        try:
            completed = subprocess.run(
                [sys.executable, "-I", "-S", "-c", _CHILD],
                input=source,
                text=True,
                capture_output=True,
                cwd=workdir,
                env={"PATH": os.defpath, "PYTHONIOENCODING": "utf-8"},
                timeout=TIME_LIMIT_SECONDS,
                check=False,
                preexec_fn=_limits if os.name == "posix" else None,
            )
            stdout = completed.stdout[:MAX_OUTPUT_CHARS]
            stderr = completed.stderr[:MAX_OUTPUT_CHARS]
            return ExecutionResult(
                stdout, stderr, completed.returncode,
                int((time.monotonic() - started) * 1000),
            )
        except subprocess.TimeoutExpired as exc:
            out = exc.stdout or ""
            err = exc.stderr or ""
            if isinstance(out, bytes):
                out = out.decode("utf-8", errors="replace")
            if isinstance(err, bytes):
                err = err.decode("utf-8", errors="replace")
            return ExecutionResult(
                out[:MAX_OUTPUT_CHARS],
                (err + "\nExecution exceeded the 5-second time limit.")[:MAX_OUTPUT_CHARS],
                124, int((time.monotonic() - started) * 1000), True,
            )
