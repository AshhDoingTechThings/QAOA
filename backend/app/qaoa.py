"""QAOA engine.

* Exact statevector simulation in NumPy (cost layer is diagonal, mixer is a
  product of RX rotations applied by tensor reshaping) — fast enough for an
  interactive demo up to 16 qubits.
* Results are cross-checked against Qiskit's Statevector, and Qiskit's
  transpiler reports real circuit depth / two-qubit gate counts.
* Noise: stochastic Pauli (depolarising) quantum trajectories inserted after
  every layer, plus read-out bit-flip error — the same noise picture as a
  Qiskit-Aer depolarising model, without the density-matrix memory cost.

Convention: qubit i ↔ bit i of the basis index (little-endian, as in Qiskit).
    |γ,β⟩ = Π_k  e^{-iβ_k H_M} e^{-iγ_k Ĥ_C} |+⟩^{⊗n},   H_M = Σ X_i,
    Ĥ_C = (H_C − offset)/s   with s = max|h,J|   (normalised so angles are O(1)).
"""
from __future__ import annotations

import math
import time
from functools import lru_cache
from typing import Dict, List, Optional

import numpy as np
from scipy.optimize import minimize

from .qubo import Model, describe_solution, feasible_mask

try:  # optional, used for verification + transpiled metrics + QASM
    from qiskit import QuantumCircuit, transpile, qasm2
    from qiskit.quantum_info import Statevector
    from qiskit.transpiler import CouplingMap
    HAVE_QISKIT = True
except Exception:  # pragma: no cover
    HAVE_QISKIT = False


