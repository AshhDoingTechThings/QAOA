"""Benchmarking under identical conditions: same instance, same seeds, same
metrics for every solver (PDF slide 22–23)."""
from __future__ import annotations

import math
import statistics as st
from typing import Dict, List

from .qaoa import run_qaoa
from .qubo import Model
from .scenario import BITS_PER_FACILITY, MAX_UNITS
from .solvers import encode_alloc, exact, greedy, simulated_annealing


