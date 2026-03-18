"""Check that Python and radarsimpy are available."""
import json
import sys

try:
    import numpy as np
    numpy_version = np.__version__
except ImportError:
    numpy_version = None

try:
    import radarsimpy
    radarsimpy_version = getattr(radarsimpy, "__version__", "unknown")
except ImportError:
    radarsimpy_version = None

result = {
    "python_version": sys.version,
    "numpy_version": numpy_version,
    "radarsimpy_version": radarsimpy_version,
    "radarsimpy_available": radarsimpy_version is not None,
}

print(json.dumps(result))
