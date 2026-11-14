import unittest

from server.python_runner import CodeRejected, execute_python, validate_source


class PythonRunnerTests(unittest.TestCase):
    def test_captures_real_stdout(self):
        result = execute_python('print("Total:", sum([10, 20, 30, 40, 50]))')
        self.assertTrue(result.passed)
        self.assertEqual(result.stdout.strip(), "Total: 150")

    def test_runs_unittest_suite(self):
        code = """
import unittest
class Checks(unittest.TestCase):
    def test_sum(self):
        self.assertEqual(sum([1, 2, 3]), 6)
unittest.main(argv=["ignored"], exit=False)
"""
        result = execute_python(code)
        self.assertTrue(result.passed, result.stderr)
        self.assertIn("OK", result.stderr + result.stdout)

    def test_rejects_network_and_os_imports(self):
        with self.assertRaises(CodeRejected):
            validate_source("import socket")
        with self.assertRaises(CodeRejected):
            validate_source("import os")

    def test_rejects_dynamic_execution(self):
        with self.assertRaises(CodeRejected):
            validate_source('eval("1 + 1")')

    def test_reports_runtime_errors(self):
        result = execute_python("print(1 / 0)")
        self.assertFalse(result.passed)
        self.assertIn("ZeroDivisionError", result.stderr)

    def test_enforces_wall_clock_timeout(self):
        result = execute_python("while True:\n    pass")
        self.assertTrue(result.timed_out)
        self.assertEqual(result.exit_code, 124)

    def test_rejects_oversized_source(self):
        with self.assertRaises(CodeRejected):
            validate_source("x = 1\n" * 11000)


if __name__ == "__main__":
    unittest.main()
